import { NextRequest, NextResponse } from 'next/server';

const XANO_API      = 'https://x8ki-letl-twmt.n7.xano.io/api:UgeJ6dlR';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

const EXAMS_SYSTEM = (today: string) =>
  `You are a helper that extracts upcoming tests and exams from Israeli school documents (Hebrew or English).
Extract each test/exam and return ONLY a JSON array:
{ "subject": "<subject in Hebrew>", "exam_date": "YYYY-MM-DD", "exam_time": "HH:MM", "notes": "<מבחן/בחינה/בוחן + any details>" }

Rules:
- exam_time: use the given time, or "08:00" if not specified
- notes: include the exam type (מבחן שנתי, מבדק שכבתי, etc.) if mentioned
- Today is ${today}. Current year: ${new Date().getFullYear()}.
- Return ONLY the JSON array, no explanation.`;

// POST /api/exams-parse
// Body: { text?, image_base64?, image_type?, childId, authToken }
export async function POST(req: NextRequest) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error('[exams-parse] ANTHROPIC_API_KEY not set');
    return NextResponse.json({ error: 'מפתח AI חסר בשרת' }, { status: 500 });
  }

  const { text, image_base64, image_type, childId, authToken } = await req.json() as {
    text?: string; image_base64?: string; image_type?: string; childId: number; authToken: string;
  };
  if ((!text && !image_base64) || !childId || !authToken) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0];

  const userContent = image_base64
    ? [
        { type: 'image', source: { type: 'base64', media_type: image_type || 'image/jpeg', data: image_base64 } },
        { type: 'text', text: 'Extract all tests and exams from this document. Return JSON array only.' },
      ]
    : (text ?? '').substring(0, 8000);

  const aiRes = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: EXAMS_SYSTEM(today),
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    console.error('[exams-parse] AI error:', aiRes.status, err.substring(0, 300));
    return NextResponse.json({ error: `שגיאת AI (${aiRes.status}): ${err.substring(0, 150)}` }, { status: 500 });
  }

  const aiData = await aiRes.json();
  const raw = aiData?.content?.[0]?.text ?? '';
  console.log('[exams-parse] AI raw:', raw.substring(0, 400));

  type ExamItem = { subject?: string; exam_date?: string; exam_time?: string; notes?: string };
  let items: ExamItem[] = [];
  try {
    const cleaned = raw.replace(/```(?:json)?\n?/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) items = JSON.parse(match[0]);
  } catch (e) {
    console.error('[exams-parse] parse error:', e);
    return NextResponse.json({ error: 'Could not parse AI response' }, { status: 422 });
  }

  if (items.length === 0) {
    return NextResponse.json({ error: 'לא נמצאו מבחנים במסמך' }, { status: 422 });
  }

  // Save each exam via Xano
  const auth = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };
  const created: unknown[] = [];
  for (const item of items) {
    if (!item.exam_date) continue;
    try {
      const r = await fetch(`${XANO_API}/child/exams`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          exam_date: item.exam_date,
          exam_time: item.exam_time || '08:00',
          notes: item.notes || item.subject || 'מבחן',
        }),
      });
      if (r.ok) created.push(await r.json());
      else console.error('[exams-parse] exam save failed:', r.status, await r.text().catch(() => ''));
    } catch {}
  }

  return NextResponse.json({ created: created.length, exams: created });
}
