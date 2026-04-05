import { NextRequest, NextResponse } from 'next/server';

const XANO_META = 'https://x8ki-letl-twmt.n7.xano.io';
const XANO_API  = 'https://x8ki-letl-twmt.n7.xano.io/api:UgeJ6dlR';
const TABLE_ID  = 714667; // schedule_slots
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

async function fetchAllSlots(metaToken: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${XANO_META}/api:meta/workspace/136523/table/${TABLE_ID}/content?page=${page}&per_page=100`,
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

async function deleteSlotsMeta(metaToken: string, ids: number[]) {
  await Promise.all(ids.map(id =>
    fetch(`${XANO_META}/api:meta/workspace/136523/table/${TABLE_ID}/content/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${metaToken}` },
    })
  ));
}

// GET /api/schedule?childId=N
export async function GET(req: NextRequest) {
  const metaToken = process.env.XANO_META_TOKEN;
  if (!metaToken) {
    console.error('[/api/schedule] XANO_META_TOKEN not set');
    return NextResponse.json([], { status: 200 });
  }

  const childId = Number(req.nextUrl.searchParams.get('childId'));
  if (!childId) return NextResponse.json({ error: 'childId required' }, { status: 400 });

  const allSlots = await fetchAllSlots(metaToken);
  const filtered = allSlots.filter(
    (s) => (s as Record<string, unknown>).user_id === childId
  );
  console.log(`[/api/schedule] childId=${childId} → ${filtered.length}/${allSlots.length} slots`);
  return NextResponse.json(filtered);
}

// DELETE /api/schedule — clear all slots for a child
// Body: { childId, authToken }
export async function DELETE(req: NextRequest) {
  const metaToken = process.env.XANO_META_TOKEN;
  if (!metaToken) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });

  const { childId } = await req.json() as { childId: number };
  if (!childId) return NextResponse.json({ error: 'childId required' }, { status: 400 });

  const allSlots = await fetchAllSlots(metaToken);
  const toDelete = allSlots
    .filter((s) => (s as Record<string, unknown>).user_id === childId)
    .map((s) => (s as Record<string, unknown>).id as number);

  await deleteSlotsMeta(metaToken, toDelete);
  console.log(`[/api/schedule] deleted ${toDelete.length} slots for childId=${childId}`);
  return NextResponse.json({ deleted: toDelete.length });
}

const SCHEDULE_SYSTEM = `You are a helper that parses Israeli school timetables (Hebrew or English).
Extract ALL schedule slots and return ONLY a JSON array. Each slot:
{ "day_of_week": "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday", "Subject": "<subject in Hebrew>", "start_time": "HH:MM", "endtime": "HH:MM" }
Hebrew days: ראשון=Sunday, שני=Monday, שלישי=Tuesday, רביעי=Wednesday, חמישי=Thursday, שישי=Friday
If end time not given, add 45 minutes. Return ONLY the JSON array, no explanation.`;

// POST /api/schedule — parse schedule text/image + replace all slots
// Body: { text?, image_base64?, image_type?, childId, authToken }
export async function POST(req: NextRequest) {
  const metaToken = process.env.XANO_META_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!metaToken || !anthropicKey) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  const { text, image_base64, image_type, childId, authToken } = await req.json() as {
    text?: string; image_base64?: string; image_type?: string; childId: number; authToken: string;
  };
  if ((!text && !image_base64) || !childId || !authToken) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  const userContent = image_base64
    ? [
        { type: 'image', source: { type: 'base64', media_type: image_type || 'image/jpeg', data: image_base64 } },
        { type: 'text', text: 'Extract all schedule slots from this school timetable image. Return JSON array only.' },
      ]
    : (text ?? '').substring(0, 8000);

  // Parse with Claude
  const aiRes = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: SCHEDULE_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    console.error('[/api/schedule POST] Claude error:', aiRes.status, err.substring(0, 200));
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
    console.error('[/api/schedule POST] parse error, raw:', raw.substring(0, 200));
    return NextResponse.json({ error: 'לא הצלחתי לקרוא את התגובה מה-AI' }, { status: 422 });
  }

  if (slots.length === 0) {
    return NextResponse.json({ error: 'לא נמצאו שיעורים בקובץ. ודא שמדובר במערכת שעות שבועית.' }, { status: 422 });
  }

  // Delete existing slots
  const allSlots = await fetchAllSlots(metaToken);
  const toDelete = allSlots
    .filter((s) => (s as Record<string, unknown>).user_id === childId)
    .map((s) => (s as Record<string, unknown>).id as number);
  await deleteSlotsMeta(metaToken, toDelete);

  // Create new slots
  const created: unknown[] = [];
  for (const slot of slots) {
    try {
      const r = await fetch(`${XANO_API}/child/schedule`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Subject: slot.Subject,
          day_of_week: slot.day_of_week,
          start_time: slot.start_time,
          endtime: slot.endtime,
          created_by_role: 'child',
        }),
      });
      if (r.ok) created.push(await r.json());
    } catch {}
  }

  console.log(`[/api/schedule POST] replaced: deleted ${toDelete.length}, created ${created.length}`);
  return NextResponse.json({ deleted: toDelete.length, created: created.length, slots: created });
}
