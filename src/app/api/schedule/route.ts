import { NextRequest, NextResponse } from 'next/server';

const XANO_META = 'https://x8ki-letl-twmt.n7.xano.io';
const TABLE_ID  = 714667; // schedule_slots
const WORKSPACE = 136523;
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

async function fetchAllSlots(metaToken: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${XANO_META}/api:meta/workspace/${WORKSPACE}/table/${TABLE_ID}/content?page=${page}&per_page=100`,
      { headers: { Authorization: `Bearer ${metaToken}` } }
    );
    if (!res.ok) break;
    const data = await res.json() as { items?: unknown[]; nextPage?: number | null } | unknown[];
    const batch = Array.isArray(data) ? data : ((data as { items?: unknown[] }).items ?? []);
    items.push(...batch);
    const next = Array.isArray(data) ? null : (data as { nextPage?: number | null }).nextPage;
    if (!next) break;
    page++;
  }
  return items;
}

async function deleteChildSlotsMeta(metaToken: string, childId: number): Promise<number> {
  const allSlots = await fetchAllSlots(metaToken);
  const toDelete = allSlots
    .filter((s) => (s as Record<string, unknown>).user_id === childId)
    .map((s) => (s as Record<string, unknown>).id as number);
  await Promise.all(toDelete.map(id =>
    fetch(`${XANO_META}/api:meta/workspace/${WORKSPACE}/table/${TABLE_ID}/content/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${metaToken}` },
    }).catch(() => {})
  ));
  return toDelete.length;
}

async function createSlotsMeta(
  metaToken: string,
  childId: number,
  slots: Array<{ day_of_week: string; Subject: string; start_time: string; endtime: string }>
): Promise<unknown[]> {
  const filtered = slots;
  const results: unknown[] = [];
  // Batch in groups of 5 to avoid overwhelming the Meta API
  for (let i = 0; i < filtered.length; i += 5) {
    const batch = filtered.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(slot =>
      fetch(
        `${XANO_META}/api:meta/workspace/${WORKSPACE}/table/${TABLE_ID}/content`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${metaToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: childId,
            Subject: slot.Subject,
            day_of_week: slot.day_of_week,
            start_time: slot.start_time,
            endtime: slot.endtime,
          }),
        }
      ).then(r => r.ok ? r.json() : null).catch(() => null)
    ));
    results.push(...batchResults.filter(Boolean));
  }
  return results;
}

// GET /api/schedule?childId=N
export async function GET(req: NextRequest) {
  const metaToken = process.env.XANO_META_TOKEN;
  if (!metaToken) return NextResponse.json([], { status: 200 });

  const childId = Number(req.nextUrl.searchParams.get('childId'));
  if (!childId) return NextResponse.json({ error: 'childId required' }, { status: 400 });

  const allSlots = await fetchAllSlots(metaToken);
  const filtered = allSlots.filter((s) => (s as Record<string, unknown>).user_id === childId);
  return NextResponse.json(filtered);
}

// DELETE /api/schedule — clear all slots for a child
export async function DELETE(req: NextRequest) {
  const metaToken = process.env.XANO_META_TOKEN;
  if (!metaToken) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });

  const { childId } = await req.json() as { childId: number };
  if (!childId) return NextResponse.json({ error: 'childId required' }, { status: 400 });

  const deleted = await deleteChildSlotsMeta(metaToken, childId);
  return NextResponse.json({ deleted });
}

// PUT /api/schedule — save pre-parsed slots to Xano (no AI, just Xano writes)
export async function PUT(req: NextRequest) {
  const metaToken = process.env.XANO_META_TOKEN;
  if (!metaToken) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });

  const { childId, slots } = await req.json() as {
    childId: number;
    slots: Array<{ day_of_week: string; Subject: string; start_time: string; endtime: string }>;
  };
  if (!childId || !Array.isArray(slots)) return NextResponse.json({ error: 'missing fields' }, { status: 400 });

  const deleted = await deleteChildSlotsMeta(metaToken, childId);
  const created = await createSlotsMeta(metaToken, childId, slots);
  console.log(`[/api/schedule PUT] deleted=${deleted} created=${created.length}`);
  return NextResponse.json({ deleted, created: created.length, slots: created });
}

const SCHEDULE_SYSTEM = `You are parsing an Israeli school weekly timetable (מערכת שעות שבועית).

STEP 1 — IDENTIFY COLUMNS:
Count the day columns and read their headers carefully. Each column is exactly ONE day.
Hebrew day headers: ראשון=Sunday, שני=Monday, שלישי=Tuesday, רביעי=Wednesday, חמישי=Thursday, שישי=Friday
The table may be RTL (right-to-left), meaning ראשון is on the RIGHT and שישי is on the LEFT.
Do NOT assign the same day to two columns. Do NOT skip a column.
⚠️ If a column header says שישי (Friday) but ALL its cells are empty or dashes — skip that column entirely. Do NOT output any Friday entries unless there is actual subject content in the Friday column.

STEP 2 — IDENTIFY ROWS:
The table has exactly ONE header row (the row with day names). Everything below it is data.
⚠️ DO NOT SKIP PERIOD 1: The row labeled "1" or "שיעור 1" or "08:00-08:45" is the FIRST DATA ROW — it contains real subjects, not headers. It MUST appear in your output with start_time "08:00".
Each row is one lesson period, labeled by number (שיעור 1, שיעור 2…) or by time (08:00-08:45).
Process ALL rows from top to bottom — do NOT skip any row, do NOT stop early. Include every row that has content.

MANDATORY CHECK: Before outputting, verify your array includes entries with start_time "08:00" (Period 1). If it does not, you skipped the first row — go back and add it.

STEP 3 — READ EACH CELL:
For every (row, column) cell that has a subject name, output one JSON entry.

⚠️ CRITICAL — SUBJECT NAME ONLY, NOT TEACHER NAME:
Each cell typically contains TWO pieces of text: the subject name (larger/first) and the teacher's name (smaller/second, often abbreviated like מ. כהן or ר׳ לוי or just initials).
Output ONLY the subject name. IGNORE the teacher name completely.
Examples of what to strip: "מתמטיקה / מ. כהן" → output "מתמטיקה". "אנגלית ר׳ לוי" → output "אנגלית".

LESSON TIMES — use these when no explicit time is shown:
Period 1: 08:00-08:45  | Period 2: 08:55-09:40  | Period 3: 09:50-10:35
Period 4: 10:45-11:30  | Period 5: 11:40-12:25  | Period 6: 12:35-13:20
Period 7: 13:30-14:15  | Period 8: 14:25-15:10  | Period 9: 15:20-16:05

⚠️ CRITICAL — EASILY CONFUSED HEBREW SUBJECTS:
- עברית = Hebrew language (letters: ע-ב-ר-י-ת)
- ערבית = Arabic language (letters: ע-ר-ב-י-ת)
These look almost identical. Read the second and third letters carefully: ב then ר = עברית, ר then ב = ערבית.

OUTPUT: Return ONLY a JSON array, no markdown, no explanation:
[{"day_of_week":"Sunday","Subject":"מתמטיקה","start_time":"08:00","endtime":"08:45"}]

RULES:
- Each column = exactly one unique day. Never duplicate a day.
- Copy subject names EXACTLY as written — do NOT translate or paraphrase
- Strip teacher names from subjects — output the subject word(s) only
- Skip empty cells, dashes, and dots only
- Include ALL non-empty cells across ALL rows — do not stop before the last row
- Return [] only if no schedule data exists at all`;



// POST /api/schedule — AI parsing ONLY, returns parsed slots without saving
// Client must follow up with PUT /api/schedule to persist
export async function POST(req: NextRequest) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });

  const { text, image_base64, image_type } = await req.json() as {
    text?: string; image_base64?: string; image_type?: string;
  };
  if (!text && !image_base64) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  const userContent = image_base64
    ? [
        { type: 'image', source: { type: 'base64', media_type: image_type || 'image/jpeg', data: image_base64 } },
        { type: 'text', text: 'Extract ALL schedule slots from this school timetable image. IMPORTANT: Include Period 1 (שיעור 1, 08:00) — do NOT treat the first data row as a header. Return JSON array only.' },
      ]
    : (text ?? '').substring(0, 8000);

  const aiRes = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: SCHEDULE_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    return NextResponse.json({ error: `שגיאת AI (${aiRes.status}): ${err.substring(0, 100)}` }, { status: 500 });
  }

  const aiData = await aiRes.json();
  const raw = (aiData?.content?.[0]?.text ?? '').trim();
  console.log('[/api/schedule POST] AI raw (first 600):', raw.substring(0, 600));

  let slots: Array<{ day_of_week: string; Subject: string; start_time: string; endtime: string }> = [];
  try {
    const cleaned = raw.replace(/```(?:json)?\n?/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) slots = JSON.parse(match[0]);
  } catch {
    return NextResponse.json({ error: 'לא הצלחתי לקרוא את התגובה מה-AI' }, { status: 422 });
  }

  if (slots.length === 0) {
    const hint = raw.length < 10
      ? 'הקובץ שהועלה לא נקרא כראוי. נסה להעלות תמונה (צילום מסך) של מערכת השעות.'
      : 'לא זוהו שיעורים. ודא שהתוכן הוא מערכת שעות שבועית עם ימים ומקצועות.';
    return NextResponse.json({ error: hint, debug_raw: raw.substring(0, 300) }, { status: 422 });
  }

  console.log(`[/api/schedule POST] parsed ${slots.length} slots`);
  console.log('[/api/schedule POST] first 3 slots:', JSON.stringify(slots.slice(0, 3)));
  // Return parsed slots only — client calls PUT to save
  return NextResponse.json({ slots, debug_count: slots.length, debug_first: slots.slice(0, 3) });
}
