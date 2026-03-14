import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const XANO_API = 'https://x8ki-letl-twmt.n7.xano.io/api:UgeJ6dlR';

export async function POST(req: NextRequest) {
  const { message, authToken } = await req.json() as { message: string; authToken: string };

  if (!message || !authToken) {
    return NextResponse.json({ reply: 'שגיאה: חסרים פרטים.' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0];

  // Ask Claude to parse the task
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: `אתה עוזר שמוסיף משימות לרשימה של ילד ישראלי.
קרא את הבקשה ובנה משימה מפרטים אלו.
היום: ${today}
ענה ב-JSON בלבד:
{
  "title": "כותרת המשימה",
  "type": "homework|test|activity|other",
  "due_date": "YYYY-MM-DDTHH:mm:ss",
  "description": "תיאור קצר (אופציונלי)"
}
אם אין תאריך ספציפי, השתמש במחר בשעה 15:00.`,
      messages: [{ role: 'user', content: message }],
    }),
  });

  let title = message;
  let type = 'homework';
  let due_date = `${today}T15:00:00`;
  let description = '';

  if (aiRes.ok) {
    const aiData = await aiRes.json();
    const raw = aiData?.content?.[0]?.text ?? '';
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        title       = parsed.title       || title;
        type        = parsed.type        || type;
        due_date    = parsed.due_date    || due_date;
        description = parsed.description || description;
      }
    } catch { /* keep defaults */ }
  }

  // Convert due_date to Unix timestamp (milliseconds)
  const due_ts = new Date(due_date).getTime();

  // Create task in Xano
  const xanoRes = await fetch(`${XANO_API}/child/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, type, due_date: due_ts, description }),
  });

  if (!xanoRes.ok) {
    const err = await xanoRes.text();
    console.error('[/api/bot] Xano error:', err);
    return NextResponse.json({ reply: 'לא הצלחתי להוסיף את המשימה. נסה שוב.' });
  }

  return NextResponse.json({
    reply: `✅ נוספה משימה: "${title}"`,
  });
}
