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

const SCHEDULE_SYSTEM = `You extract data from an Israeli school weekly timetable (מערכת שעות שבועית).

TABLE LAYOUT:
- ONE header row: day names (ראשון, שני, שלישי, רביעי, חמישי, and optionally שישי)
- ONE left column: period labels (1, 2, 3… or שיעור 1, שיעור 2…) — this is a row-index column, NOT a subject
- Remaining columns: one per school day, each cell contains a subject (and sometimes a teacher name)
- The table may be RTL: ראשון on the right, שישי on the left

DAY NAMES → English:
ראשון=Sunday | שני=Monday | שלישי=Tuesday | רביעי=Wednesday | חמישי=Thursday | שישי=Friday

PERIOD DEFAULT TIMES (use when the image shows no explicit times):
Period 1→08:00-08:45 | Period 2→08:55-09:40 | Period 3→09:50-10:35
Period 4→10:45-11:30 | Period 5→11:40-12:25 | Period 6→12:35-13:20
Period 7→13:30-14:15 | Period 8→14:25-15:10 | Period 9→15:20-16:05

SUBJECT EXTRACTION:
Each cell has a subject name (larger text) and often a teacher name (smaller text or initials like מ. כהן, ר׳ לוי).
Output the subject name ONLY. Strip teacher names completely.
"מתמטיקה / מ. כהן" → "מתמטיקה" | "אנגלית ר׳ לוי" → "אנגלית"

EASILY CONFUSED: ערבית (Arabic: ע-ר-ב) ≠ עברית (Hebrew: ע-ב-ר). Read carefully.

EXAMPLE — for a table with 3 periods and ראשון/שני columns:
[
  {"day_of_week":"Sunday","Subject":"מתמטיקה","start_time":"08:00","endtime":"08:45"},
  {"day_of_week":"Monday","Subject":"אנגלית","start_time":"08:00","endtime":"08:45"},
  {"day_of_week":"Sunday","Subject":"עברית","start_time":"08:55","endtime":"09:40"},
  {"day_of_week":"Monday","Subject":"מדע","start_time":"08:55","endtime":"09:40"},
  {"day_of_week":"Sunday","Subject":"תנ\"ך","start_time":"09:50","endtime":"10:35"},
  {"day_of_week":"Monday","Subject":"חינוך גופני","start_time":"09:50","endtime":"10:35"}
]
Notice: Period 1 (08:00) entries come FIRST and are included — they are data rows, not headers.

RULES:
- Output a flat JSON array, no markdown, no explanation
- Period 1 (first data row) MUST be in your output — it is NOT a header
- Each day column = exactly one unique day name; never duplicate a day
- Skip שישי column entirely if ALL its cells are empty or dashes
- Skip empty cells, dashes, free-period markers
- Include every row that has subject content, all the way to the last period`;



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
        { type: 'text', text: 'Extract every schedule slot from this timetable. Include period 1 (first data row). Output JSON array only.' },
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
      messages: [
        { role: 'user', content: userContent },
        { role: 'assistant', content: '[' }, // prefill: forces AI to output JSON array immediately
      ],
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    return NextResponse.json({ error: `שגיאת AI (${aiRes.status}): ${err.substring(0, 100)}` }, { status: 500 });
  }

  const aiData = await aiRes.json();
  // Prepend '[' because we prefilled it — the AI response continues from after the prefill
  const raw = '[' + (aiData?.content?.[0]?.text ?? '').trim();
  console.log('[/api/schedule POST] AI raw (first 600):', raw.substring(0, 600));

  let slots: Array<{ day_of_week: string; Subject: string; start_time: string; endtime: string }> = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
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
