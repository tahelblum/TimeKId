import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const XANO_API = 'https://x8ki-letl-twmt.n7.xano.io/api:UgeJ6dlR';

export async function POST(req: NextRequest) {
  const { message, authToken } = await req.json() as { message: string; authToken: string };

  if (!message || !authToken) {
    return NextResponse.json({ reply: 'שגיאה: חסרים פרטים.' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0];

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: `You are a bot that helps Israeli children manage their schedule and tasks. Today is ${today}.
The user may write in Hebrew, English, or a mix.

Decide if the request is:
- A RECURRING weekly activity (e.g. "soccer every Tuesday", "כדורגל כל שלישי", "add swimming every Monday 16:00") → kind: "schedule"
- A ONE-TIME task or homework (e.g. "math homework tomorrow", "שיעורי בית מתמטיקה", "test on Thursday") → kind: "task"

Reply with JSON only (no markdown, no explanation):

For a recurring weekly activity:
{
  "kind": "schedule",
  "subject": "<activity name in Hebrew if possible>",
  "day_of_week": "<Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday>",
  "start_time": "<HH:MM>",
  "end_time": "<HH:MM — add 1 hour if not specified>"
}

For a one-time task:
{
  "kind": "task",
  "title": "<task title in Hebrew if possible>",
  "type": "<homework|test|activity|other>",
  "due_date": "<YYYY-MM-DDTHH:mm:ss>",
  "description": "<optional short description>"
}

If no date is given for a task, use tomorrow at 15:00.
If no time is given for a schedule slot, use 15:00.`,
      messages: [{ role: 'user', content: message }],
    }),
  });

  if (!aiRes.ok) {
    console.error('[/api/bot] Anthropic error:', aiRes.status);
    return NextResponse.json({ reply: 'לא הצלחתי להבין את הבקשה. נסה שוב.' });
  }

  const aiData = await aiRes.json();
  const raw = aiData?.content?.[0]?.text ?? '';

  let parsed: Record<string, string> | null = null;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch { /* ignore */ }

  if (!parsed) {
    return NextResponse.json({ reply: 'לא הצלחתי להבין את הבקשה. נסה שוב.' });
  }

  // --- Recurring schedule slot ---
  if (parsed.kind === 'schedule') {
    const xanoRes = await fetch(`${XANO_API}/child/schedule`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Subject: parsed.subject || message,
        day_of_week: parsed.day_of_week || 'Sunday',
        start_time: parsed.start_time || '15:00',
        endtime: parsed.end_time || '16:00',
        created_by_role: 'child',
      }),
    });

    if (!xanoRes.ok) {
      const err = await xanoRes.text();
      console.error('[/api/bot] Xano schedule error:', err);
      return NextResponse.json({ reply: 'לא הצלחתי להוסיף את הפעילות. נסה שוב.' });
    }

    return NextResponse.json({
      reply: `✅ נוספה פעילות קבועה: "${parsed.subject}" כל ${parsed.day_of_week} בשעה ${parsed.start_time}`,
    });
  }

  // --- One-time task ---
  const title = parsed.title || message;
  const type = parsed.type || 'homework';
  const due_date = parsed.due_date || `${today}T15:00:00`;
  const description = parsed.description || '';
  const due_ts = new Date(due_date).getTime();

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
    console.error('[/api/bot] Xano task error:', err);
    return NextResponse.json({ reply: 'לא הצלחתי להוסיף את המשימה. נסה שוב.' });
  }

  return NextResponse.json({
    reply: `✅ נוספה משימה: "${title}"`,
  });
}
