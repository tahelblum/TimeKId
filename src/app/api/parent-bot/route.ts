import { NextRequest, NextResponse } from 'next/server';

const XANO_META = 'https://x8ki-letl-twmt.n7.xano.io/api:meta/workspace/136523';
const TASK_TABLE     = 683759;
const SCHEDULE_TABLE = 714667;
const ANTHROPIC_API  = 'https://api.anthropic.com/v1/messages';

async function metaInsert(metaToken: string, tableId: number, data: Record<string, unknown>) {
  try {
    const res = await fetch(`${XANO_META}/table/${tableId}/content`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${metaToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[metaInsert] table ${tableId} failed ${res.status}:`, errText.substring(0, 300));
      return null;
    }
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text || true; }
  } catch (e) {
    console.error(`[metaInsert] table ${tableId} threw:`, e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const metaToken    = process.env.XANO_META_TOKEN;
  if (!anthropicKey) {
    console.error('[/api/parent-bot] ANTHROPIC_API_KEY not set');
    return NextResponse.json({ reply: 'שגיאת שרת: מפתח AI חסר.' }, { status: 500 });
  }
  if (!metaToken) {
    console.error('[/api/parent-bot] XANO_META_TOKEN not set');
    return NextResponse.json({ reply: 'שגיאת שרת: מפתח Xano חסר.' }, { status: 500 });
  }

  const { message, file_content, image_base64, image_type, child_id, auth_token } = await req.json() as {
    message?: string;
    file_content?: string;
    image_base64?: string;
    image_type?: string;
    child_id: number;
    auth_token: string;
  };

  if (!child_id || !auth_token) {
    return NextResponse.json({ reply: 'שגיאה: חסרים פרטים.' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0];
  const isImage = !!image_base64;
  const isFile = !!file_content || isImage;
  const inputText = (message || file_content || '').trim();
  if (!inputText && !isImage) return NextResponse.json({ reply: 'לא התקבל תוכן.' }, { status: 400 });

  const systemPrompt = isFile
    ? `You are a helper that extracts tasks and events from a school document (Hebrew or English).
This may be a test/exam schedule or a weekly class schedule.
For test schedules: extract each test/exam as a task with type "test".
For weekly schedules: extract each subject per day as a recurring schedule slot.
Return ONLY a JSON array — no explanation, no markdown:
For tasks/tests: [{ "kind": "task", "title": "<subject in Hebrew> - מבחן", "type": "test", "due_date": "YYYY-MM-DDTHH:mm:ss", "description": "<מבחן/מבדק/שכבתי>" }]
For schedule slots: [{ "kind": "schedule", "subject": "<subject in Hebrew>", "day_of_week": "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday", "start_time": "HH:MM", "end_time": "HH:MM" }]
You may mix both kinds in the same array if the document contains both.
Today is ${today}. The current year is ${new Date().getFullYear()}. Use the correct year for dates.`
    : `You are a bot helping Israeli parents manage their child's schedule. Today is ${today}.
The parent may write in Hebrew, English, or a mix.

Decide if the request is:
- A RECURRING weekly activity (e.g. "soccer every Tuesday", "כדורגל כל שלישי") → kind: "schedule"
- A ONE-TIME task or homework → kind: "task"

Reply with JSON only (no markdown):

For recurring: { "kind": "schedule", "subject": "<name in Hebrew>", "day_of_week": "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday", "start_time": "HH:MM", "end_time": "HH:MM" }
For one-time:  { "kind": "task", "title": "<title in Hebrew>", "type": "homework|test|activity|other", "due_date": "YYYY-MM-DDTHH:mm:ss", "description": "<optional>" }

If no date given for task, use tomorrow at 15:00. If no time given for schedule, use 15:00.`;

  const userContent = isImage
    ? [
        { type: 'image', source: { type: 'base64', media_type: image_type || 'image/jpeg', data: image_base64 } },
        { type: 'text', text: 'Extract all tasks, tests, and schedule slots from this school document image. Return JSON array only.' },
      ]
    : inputText.substring(0, 8000);

  const aiRes = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: isFile ? 2000 : 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  // --- File / Image mode: extract tasks and/or schedule slots ---
  if (isFile) {
    type ExtractedItem = { kind?: string; title?: string; type?: string; due_date?: string; description?: string; subject?: string; day_of_week?: string; start_time?: string; end_time?: string };
    let items: ExtractedItem[] = [];
    if (!aiRes.ok) {
      const errBody = await aiRes.text();
      console.error('[parent-bot] AI API error:', aiRes.status, errBody.substring(0, 300));
      return NextResponse.json({ reply: `שגיאת AI (${aiRes.status}). בדוק שה-API key תקין.` }, { status: 500 });
    }
    const aiData = await aiRes.json();
    const raw = aiData?.content?.[0]?.text ?? '';
    console.log('[parent-bot] AI raw response (full):', raw);
    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/```(?:json)?\n?/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) items = JSON.parse(match[0]);
    } catch (e) { console.error('[parent-bot] JSON parse error:', e); }
    if (items.length === 0) {
      console.error('[parent-bot] No items parsed from:', raw.substring(0, 300));
      return NextResponse.json({ reply: 'לא מצאתי משימות במסמך. נסה שוב.' });
    }

    let createdTasks = 0, createdSlots = 0;
    for (const item of items) {
      if (item.kind === 'schedule') {
        const insertData = {
          Subject: item.subject || 'שיעור',
          day_of_week: item.day_of_week || 'Sunday',
          start_time: item.start_time || '08:00',
          endtime: item.end_time || '09:00',
          created_by_role: 'parent',
          user_id: child_id,
          children_id: child_id,
        };
        console.log('[parent-bot] inserting schedule slot:', JSON.stringify(insertData));
        const rec = await metaInsert(metaToken, SCHEDULE_TABLE, insertData);
        if (rec) createdSlots++;
        else console.error('[parent-bot] schedule insert returned null for:', insertData);
      } else {
        const due_ts = new Date(item.due_date || `${today}T15:00:00`).getTime();
        const rec = await metaInsert(metaToken, TASK_TABLE, {
          title: item.title || 'משימה',
          type: item.type || 'homework',
          due_date: due_ts,
          description: item.description || '',
          child_id,
          status: 'pending',
          created_by_role: 'parent',
        });
        if (rec) createdTasks++;
      }
    }
    const parts = [];
    if (createdTasks > 0) parts.push(`${createdTasks} משימות`);
    if (createdSlots > 0) parts.push(`${createdSlots} שיעורים לוח זמנים`);
    if (parts.length === 0) return NextResponse.json({ reply: 'לא הצלחתי לשמור את הפריטים. נסה שוב.' });
    return NextResponse.json({ reply: `✅ נוצרו ${parts.join(' ו-')} מהמסמך!` });
  }

  // --- Text message mode ---
  let parsed: Record<string, string> | null = null;
  if (aiRes.ok) {
    const aiData = await aiRes.json();
    const raw = aiData?.content?.[0]?.text ?? '';
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch { /* ignore */ }
  }
  if (!parsed) parsed = { kind: 'task', title: inputText, type: 'other' };

  // Recurring schedule slot
  if (parsed.kind === 'schedule') {
    const rec = await metaInsert(metaToken, SCHEDULE_TABLE, {
      Subject: parsed.subject || inputText,
      day_of_week: parsed.day_of_week || 'Sunday',
      start_time: parsed.start_time || '15:00',
      endtime: parsed.end_time || '16:00',
      created_by_role: 'parent',
      user_id: child_id,
      children_id: child_id,
    });
    if (!rec) return NextResponse.json({ reply: 'לא הצלחתי להוסיף את הפעילות. נסה שוב.' });
    return NextResponse.json({ reply: `✅ נוספה פעילות קבועה: "${parsed.subject}" כל ${parsed.day_of_week} בשעה ${parsed.start_time}` });
  }

  // One-time task
  const due_ts = new Date(parsed.due_date || `${today}T15:00:00`).getTime();
  const rec = await metaInsert(metaToken, TASK_TABLE, {
    title: parsed.title || inputText,
    type: parsed.type || 'homework',
    due_date: due_ts,
    description: parsed.description || '',
    child_id,
    status: 'pending',
    created_by_role: 'parent',
  });
  if (!rec) return NextResponse.json({ reply: 'לא הצלחתי להוסיף את המשימה. נסה שוב.' });
  return NextResponse.json({ reply: `✅ נוספה משימה: "${parsed.title || inputText}"` });

  } catch (err) {
    console.error('[/api/parent-bot] unhandled error:', err);
    return NextResponse.json({ reply: 'שגיאת שרת לא צפויה.' }, { status: 500 });
  }
}
