import { NextRequest, NextResponse } from 'next/server';

const XANO_API = 'https://x8ki-letl-twmt.n7.xano.io/api:UgeJ6dlR';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

export async function POST(req: NextRequest) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return NextResponse.json({ reply: 'שגיאת שרת.' }, { status: 500 });

  const { message, file_content, child_id, auth_token } = await req.json() as {
    message?: string;
    file_content?: string;
    child_id: number;
    auth_token: string;
  };

  if (!child_id || !auth_token) {
    return NextResponse.json({ reply: 'שגיאה: חסרים פרטים.' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0];
  const inputText = message || file_content || '';

  if (!inputText.trim()) {
    return NextResponse.json({ reply: 'לא התקבל תוכן לעיבוד.' }, { status: 400 });
  }

  const isFile = !!file_content;

  const systemPrompt = isFile
    ? `You are a helper that extracts tasks and events from a school document (Hebrew or English).
Extract ALL tasks, homework assignments, tests, and events.
Return ONLY a JSON array of tasks:
[{ "title": "<title in Hebrew>", "type": "homework|test|activity|other", "due_date": "YYYY-MM-DDTHH:mm:ss", "description": "<optional>" }]
Today is ${today}. If no date is clear, use tomorrow at 15:00. Return ONLY the JSON array.`
    : `You are a bot that helps Israeli parents manage their child's schedule and tasks. Today is ${today}.
The parent may write in Hebrew, English, or a mix.

Decide if the request is:
- A RECURRING weekly activity (e.g. "soccer every Tuesday", "כדורגל כל שלישי") → kind: "schedule"
- A ONE-TIME task or homework → kind: "task"

Reply with JSON only (no markdown):

For recurring weekly activity:
{ "kind": "schedule", "subject": "<name in Hebrew>", "day_of_week": "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday", "start_time": "HH:MM", "end_time": "HH:MM" }

For one-time task:
{ "kind": "task", "title": "<title in Hebrew>", "type": "homework|test|activity|other", "due_date": "YYYY-MM-DDTHH:mm:ss", "description": "<optional>" }

If no date given for task, use tomorrow at 15:00. If no time given for schedule, use 15:00.`;

  // Call Claude
  const aiRes = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: isFile ? 1500 : 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: inputText.substring(0, 8000) }],
    }),
  });

  const authHeaders = {
    Authorization: `Bearer ${auth_token}`,
    'Content-Type': 'application/json',
  };

  // --- File mode: extract multiple tasks ---
  if (isFile) {
    let tasks: Array<{ title: string; type: string; due_date: string; description?: string }> = [];

    if (aiRes.ok) {
      const aiData = await aiRes.json();
      const raw = aiData?.content?.[0]?.text ?? '';
      try {
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) tasks = JSON.parse(match[0]);
      } catch { /* ignore */ }
    }

    if (tasks.length === 0) {
      return NextResponse.json({ reply: 'לא מצאתי משימות במסמך. נסה שוב.' });
    }

    let created = 0;
    for (const task of tasks) {
      try {
        const due_ts = new Date(task.due_date || `${today}T15:00:00`).getTime();
        const r = await fetch(`${XANO_API}/children/${child_id}/tasks`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            title: task.title,
            type: task.type || 'homework',
            due_date: due_ts,
            description: task.description || '',
          }),
        });
        if (r.ok) created++;
      } catch {}
    }

    return NextResponse.json({
      reply: `✅ נוצרו ${created} משימות מהמסמך!`,
    });
  }

  // --- Text message mode: single task or schedule ---
  let parsed: Record<string, string> | null = null;
  if (aiRes.ok) {
    const aiData = await aiRes.json();
    const raw = aiData?.content?.[0]?.text ?? '';
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch { /* ignore */ }
  }

  if (!parsed) {
    parsed = { kind: 'task', title: inputText, type: 'other' };
  }

  // Recurring schedule slot
  if (parsed.kind === 'schedule') {
    const xanoRes = await fetch(`${XANO_API}/children/${child_id}/schedule`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        Subject: parsed.subject || inputText,
        day_of_week: parsed.day_of_week || 'Sunday',
        start_time: parsed.start_time || '15:00',
        endtime: parsed.end_time || '16:00',
        created_by_role: 'parent',
      }),
    });

    if (!xanoRes.ok) {
      const err = await xanoRes.text();
      console.error('[/api/parent-bot] schedule error:', err);
      return NextResponse.json({ reply: 'לא הצלחתי להוסיף את הפעילות. נסה שוב.' });
    }

    return NextResponse.json({
      reply: `✅ נוספה פעילות קבועה: "${parsed.subject}" כל ${parsed.day_of_week} בשעה ${parsed.start_time}`,
    });
  }

  // One-time task
  const title = parsed.title || inputText;
  const type = parsed.type || 'homework';
  const due_ts = new Date(parsed.due_date || `${today}T15:00:00`).getTime();
  const description = parsed.description || '';

  const xanoRes = await fetch(`${XANO_API}/children/${child_id}/tasks`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ title, type, due_date: due_ts, description }),
  });

  if (!xanoRes.ok) {
    const err = await xanoRes.text();
    console.error('[/api/parent-bot] task error:', err);
    return NextResponse.json({ reply: 'לא הצלחתי להוסיף את המשימה. נסה שוב.' });
  }

  return NextResponse.json({ reply: `✅ נוספה משימה: "${title}"` });
}
