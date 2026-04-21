import { NextRequest, NextResponse } from 'next/server';

const XANO_META = 'https://x8ki-letl-twmt.n7.xano.io';
const TABLE_ID  = 714667; // schedule_slots
const WORKSPACE = 136523;
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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
  // Delete in parallel batches of 5 to stay within Meta API limits
  for (let i = 0; i < toDelete.length; i += 5) {
    await Promise.all(toDelete.slice(i, i + 5).map(id =>
      fetch(`${XANO_META}/api:meta/workspace/${WORKSPACE}/table/${TABLE_ID}/content/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${metaToken}` },
      })
    ));
    if (i + 5 < toDelete.length) await sleep(200);
  }
  return toDelete.length;
}

async function createSlotsMeta(
  metaToken: string,
  childId: number,
  slots: Array<{ day_of_week: string; Subject: string; start_time: string; endtime: string }>
): Promise<unknown[]> {
  const created: unknown[] = [];
  for (const slot of slots) {
    try {
      const r = await fetch(
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
      );
      if (r.ok) created.push(await r.json());
    } catch {}
  }
  return created;
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

// PUT /api/schedule — replace all slots with a pre-parsed array (no AI)
// Used by the manual grid submit in KidDashboard
export async function PUT(req: NextRequest) {
  const metaToken = process.env.XANO_META_TOKEN;
  if (!metaToken) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });

  const { childId, slots } = await req.json() as {
    childId: number;
    slots: Array<{ day_of_week: string; Subject: string; start_time: string; endtime: string }>;
  };
  if (!childId || !slots) return NextResponse.json({ error: 'missing fields' }, { status: 400 });

  const deleted = await deleteChildSlotsMeta(metaToken, childId);
  const created = await createSlotsMeta(metaToken, childId, slots);
  console.log(`[/api/schedule PUT] replaced: deleted ${deleted}, created ${created.length}`);
  return NextResponse.json({ deleted, created: created.length, slots: created });
}

const SCHEDULE_SYSTEM = `You are a helper that parses Israeli school timetables (Hebrew or English).
Extract schedule slots and return ONLY a JSON array. Each slot:
{ "day_of_week": "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday", "Subject": "<exact subject name as written>", "start_time": "HH:MM", "endtime": "HH:MM" }
Hebrew days: ראשון=Sunday, שני=Monday, שלישי=Tuesday, רביעי=Wednesday, חמישי=Thursday, שישי=Friday
If end time not given, add 45 minutes. If no time at all, use 08:00 for the first slot and add 45 min per subsequent slot.
Rules:
- Extract subjects as written — do NOT translate, do NOT invent
- Skip empty or unclear cells
- If the input looks like a list of subjects per day (even without times), still extract them
- Return ONLY the JSON array, no markdown, no explanation
- If you cannot find any schedule data at all, return []`;

// POST /api/schedule — parse schedule text/image with AI + replace all slots
export async function POST(req: NextRequest) {
  const metaToken = process.env.XANO_META_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!metaToken || !anthropicKey) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  const { text, image_base64, image_type, childId } = await req.json() as {
    text?: string; image_base64?: string; image_type?: string; childId: number; authToken?: string;
  };
  if ((!text && !image_base64) || !childId) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  const userContent = image_base64
    ? [
        { type: 'image', source: { type: 'base64', media_type: image_type || 'image/jpeg', data: image_base64 } },
        { type: 'text', text: 'Extract all schedule slots from this school timetable image. Return JSON array only.' },
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
      max_tokens: 2000,
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
  console.log('[/api/schedule POST] AI raw:', raw.substring(0, 400));

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

  // All Xano writes go through Meta API — no user API quota consumed
  const deleted = await deleteChildSlotsMeta(metaToken, childId);
  const created = await createSlotsMeta(metaToken, childId, slots);
  console.log(`[/api/schedule POST] replaced: deleted ${deleted}, created ${created.length}`);
  return NextResponse.json({ deleted, created: created.length, slots: created });
}
