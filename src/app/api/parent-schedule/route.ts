import { NextRequest, NextResponse } from 'next/server';

const XANO_META = 'https://x8ki-letl-twmt.n7.xano.io';
const XANO_API  = `${XANO_META}/api:UgeJ6dlR`;
const TABLE_ID  = 714667; // schedule_slots

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

// GET /api/parent-schedule?childId=N — parent app
export async function GET(req: NextRequest) {
  const metaToken = process.env.XANO_META_TOKEN;
  if (!metaToken) {
    console.error('[/api/parent-schedule] XANO_META_TOKEN not set');
    return NextResponse.json([], { status: 200 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const childId    = Number(req.nextUrl.searchParams.get('childId'));
  if (!childId) return NextResponse.json({ error: 'childId required' }, { status: 400 });

  // Validate parent token
  const meRes = await fetch(`${XANO_API}/auth/me`, {
    headers: { Authorization: authHeader },
  }).catch(() => null);

  if (!meRes?.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const allSlots = await fetchAllSlots(metaToken);
  const filtered = allSlots.filter(
    (s) => (s as Record<string, unknown>).children_id === childId
  );
  console.log(`[/api/parent-schedule] childId=${childId} → ${filtered.length}/${allSlots.length} slots`);
  return NextResponse.json(filtered);
}
