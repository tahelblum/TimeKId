import { NextRequest, NextResponse } from 'next/server';

const XANO_META  = 'https://x8ki-letl-twmt.n7.xano.io';
const XANO_API   = `${XANO_META}/api:UgeJ6dlR`;
const TABLE_ID   = 714667; // schedule_slots

async function fetchAllSlots(metaToken: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${XANO_META}/api:meta/workspace/136523/table/${TABLE_ID}/content?page=${page}&per_page=100`,
      { headers: { Authorization: `Bearer ${metaToken}` } }
    );
    if (!res.ok) break;
    const data = await res.json() as { items?: unknown[]; curPage?: number; nextPage?: number | null } | unknown[];
    const batch = Array.isArray(data) ? data : ((data as { items?: unknown[] }).items ?? []);
    items.push(...batch);
    const next = Array.isArray(data) ? null : (data as { nextPage?: number | null }).nextPage;
    if (!next) break;
    page++;
  }
  return items;
}

// GET /api/schedule — child app: returns schedule slots for the authenticated child
export async function GET(req: NextRequest) {
  const metaToken = process.env.XANO_META_TOKEN;
  if (!metaToken) return NextResponse.json([], { status: 200 });

  const authHeader = req.headers.get('authorization') ?? '';

  // Validate child token + get child ID
  const meRes = await fetch(`${XANO_API}/auth/child-me`, {
    headers: { Authorization: authHeader },
  }).catch(() => null);

  if (!meRes?.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const me = await meRes.json() as { id?: number };
  const childId = me?.id;
  if (!childId) return NextResponse.json([], { status: 200 });

  const allSlots = await fetchAllSlots(metaToken);
  const filtered = allSlots.filter(
    (s) => (s as Record<string, unknown>).user_id === childId
  );
  return NextResponse.json(filtered);
}
