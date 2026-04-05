import { NextRequest, NextResponse } from 'next/server';

const XANO_META     = 'https://x8ki-letl-twmt.n7.xano.io/api:meta/workspace/136523';
const TASK_TABLE     = 683759;
const SCHEDULE_TABLE = 714667;
const ANTHROPIC_API  = 'https://api.anthropic.com/v1/messages';

async function deleteExistingSlots(metaToken: string, childId: number) {
  try {
    let page = 1;
    const toDelete: number[] = [];
    while (true) {
      const res = await fetch(`${XANO_META}/table/${SCHEDULE_TABLE}/content?page=${page}&per_page=100`, {
        headers: { Authorization: `Bearer ${metaToken}` },
      });
      if (!res.ok) break;
      const data = await res.json() as { items?: Record<string, unknown>[]; nextPage?: number | null } | Record<string, unknown>[];
      const batch = Array.isArray(data) ? data : ((data as { items?: Record<string, unknown>[] }).items ?? []);
      batch.filter(s => s.user_id === childId || s.children_id === childId).forEach(s => toDelete.push(s.id as number));
      const next = Array.isArray(data) ? null : (data as { nextPage?: number | null }).nextPage;
      if (!next) break;
      page++;
    }
    await Promise.all(toDelete.map(id =>
      fetch(`${XANO_META}/table/${SCHEDULE_TABLE}/content/${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${metaToken}` },
      })
    ));
    console.log(`[parent-bot] deleted ${toDelete.length} existing slots for child ${childId}`);
  } catch (e) { console.error('[parent-bot] deleteExistingSlots error:', e); }
}

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

// ── Prompts ────────────────────────────────────────────────────────────────

const FILE_SYSTEM_PROMPT = (today: string) =>
  `You are a helper that extracts structured data from Israeli school documents (Hebrew or English).
A document can contain ONE or MORE of the following:
1. WEEKLY SCHOOL TIMETABLE — recurring lessons each week (מערכת שעות). Extract each lesson as a schedule slot.
2. TEST/EXAM SCHEDULE — upcoming tests (מבחנים, בחינות, בוחנים). Extract each as a task with type "test".
3. HOMEWORK or ONE-TIME TASKS — single assignments. Extract as tasks.

CRITICAL RULES:
- Extract ONLY what is explicitly written. Do NOT guess, infer, or hallucinate any subjects or dates.
- Copy subject names EXACTLY as they appear in the document — do NOT translate them to Hebrew or English.
- If a cell is empty or unreadable, skip it entirely.

Return ONLY a raw JSON array (no markdown, no explanation):

Schedule slot shape:
{ "kind": "schedule", "subject": "<copy subject name exactly as written>", "day_of_week": "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday", "start_time": "HH:MM", "end_time": "HH:MM" }

Task shape:
{ "kind": "task", "title": "<Hebrew title>", "type": "test|homework|activity|other", "due_date": "YYYY-MM-DDTHH:mm:ss", "description": "" }

Rules:
- Day names in Hebrew: ראשון→Sunday, שני→Monday, שלישי→Tuesday, רביעי→Wednesday, חמישי→Thursday, שישי→Friday
- If a document has a weekly grid → emit schedule slots (one per subject per day). Skip empty cells.
- Tests/exams (מבחן, בחינה, בוחן, מבדק, שכבתי) → task with type "test"
- If no date given for a test → estimate based on context, default to two weeks from today
- Today is ${today}. Current year: ${new Date().getFullYear()}.`;

const TEXT_SYSTEM_PROMPT = (today: string) =>
  `You help Israeli parents add items to their child's school schedule. Today is ${today}.
The parent writes in Hebrew, English, or a mix.

Classify the request as ONE of:
A) RECURRING WEEKLY SLOT — a lesson or activity that repeats every week (מערכת שעות, שיעור קבוע, חוג)
B) ONE-TIME TASK or TEST — homework, a specific test, or a one-time event

Reply with raw JSON only (no markdown):

For (A): { "kind": "schedule", "subject": "<Hebrew name>", "day_of_week": "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday", "start_time": "HH:MM", "end_time": "HH:MM" }
For (B): { "kind": "task", "title": "<Hebrew title>", "type": "homework|test|activity|other", "due_date": "YYYY-MM-DDTHH:mm:ss", "description": "" }

Rules:
- Hebrew days: ראשון=Sunday, שני=Monday, שלישי=Tuesday, רביעי=Wednesday, חמישי=Thursday, שישי=Friday
- Words like מבחן/בחינה/בוחן/מבדק → type "test"
- If no time given for schedule → use "08:00" for morning school slots
- If no date given for task → use tomorrow at 15:00
- If no end_time → add 45 minutes to start_time`;

// ── Handler ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const metaToken    = process.env.XANO_META_TOKEN;
    if (!anthropicKey) {
      console.error('[parent-bot] ANTHROPIC_API_KEY not set');
      return NextResponse.json({ reply: 'שגיאת שרת: מפתח AI חסר.' }, { status: 500 });
    }
    if (!metaToken) {
      console.error('[parent-bot] XANO_META_TOKEN not set');
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

    const today    = new Date().toISOString().split('T')[0];
    const isImage  = !!image_base64;
    const isFile   = !!file_content || isImage;
    const inputText = (message || file_content || '').trim();
    if (!inputText && !isImage) return NextResponse.json({ reply: 'לא התקבל תוכן.' }, { status: 400 });

    // Build request to Claude
    const userContent = isImage
      ? [
          { type: 'image', source: { type: 'base64', media_type: image_type || 'image/jpeg', data: image_base64 } },
          { type: 'text', text: 'Extract all schedule slots and tasks from this school document. Return a JSON array only.' },
        ]
      : inputText.substring(0, 8000);

    const aiRes = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: isFile ? 2000 : 600,
        system: isFile ? FILE_SYSTEM_PROMPT(today) : TEXT_SYSTEM_PROMPT(today),
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.text();
      console.error('[parent-bot] AI error:', aiRes.status, errBody.substring(0, 500));
      return NextResponse.json({ reply: `שגיאת AI (${aiRes.status}): ${errBody.substring(0, 200)}` }, { status: 500 });
    }

    const aiData = await aiRes.json();
    const raw    = (aiData?.content?.[0]?.text ?? '').trim();
    console.log('[parent-bot] AI raw:', raw.substring(0, 500));

    // ── FILE / IMAGE mode ────────────────────────────────────────────────
    if (isFile) {
      type Item = { kind?: string; title?: string; type?: string; due_date?: string; description?: string; subject?: string; day_of_week?: string; start_time?: string; end_time?: string };
      let items: Item[] = [];
      try {
        const cleaned = raw.replace(/```(?:json)?\n?/g, '').trim();
        const match   = cleaned.match(/\[[\s\S]*\]/);
        if (match) items = JSON.parse(match[0]);
      } catch (e) { console.error('[parent-bot] JSON parse error:', e); }

      if (items.length === 0) {
        console.error('[parent-bot] No items from AI. Raw:', raw.substring(0, 300));
        return NextResponse.json({ reply: 'לא הצלחתי לזהות משימות או שיעורים במסמך. נסה שנית.' });
      }

      // If any schedule slots in the doc, delete existing ones first to avoid duplicates
      const hasSchedule = items.some(i => i.kind === 'schedule');
      if (hasSchedule) await deleteExistingSlots(metaToken, child_id);

      let createdTasks = 0, createdSlots = 0;
      for (const item of items) {
        if (item.kind === 'schedule') {
          const row = {
            Subject:          item.subject || 'שיעור',
            day_of_week:      item.day_of_week || 'Sunday',
            start_time:       item.start_time  || '08:00',
            endtime:          item.end_time    || '08:45',
            created_by_role:  'parent',
            user_id:          child_id,
            children_id:      child_id,
          };
          console.log('[parent-bot] schedule insert:', JSON.stringify(row));
          const rec = await metaInsert(metaToken, SCHEDULE_TABLE, row);
          if (rec) createdSlots++;
          else console.error('[parent-bot] schedule insert failed for:', row);
        } else {
          const due_ts = new Date(item.due_date || `${today}T15:00:00`).getTime();
          const row = {
            title:            item.title || 'משימה',
            type:             item.type  || 'homework',
            due_date:         due_ts,
            description:      item.description || '',
            child_id,
            status:           'pending',
            source:           'parent',
            created_by_role:  'parent',
          };
          console.log('[parent-bot] task insert:', JSON.stringify(row));
          const rec = await metaInsert(metaToken, TASK_TABLE, row);
          if (rec) createdTasks++;
          else console.error('[parent-bot] task insert failed for:', row);
        }
      }

      const parts: string[] = [];
      if (createdTasks > 0) parts.push(`${createdTasks} משימות`);
      if (createdSlots > 0) parts.push(`${createdSlots} שיעורים במערכת`);
      if (parts.length === 0)
        return NextResponse.json({ reply: 'לא הצלחתי לשמור את הפריטים. ודא שמפתח Xano מעודכן ב-Vercel.' });
      return NextResponse.json({ reply: `✅ נוספו ${parts.join(' ו-')} מהמסמך!` });
    }

    // ── TEXT mode ────────────────────────────────────────────────────────
    let parsed: Record<string, string> | null = null;
    try {
      const cleaned = raw.replace(/```(?:json)?\n?/g, '').trim();
      const match   = cleaned.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch { /* ignore */ }

    if (!parsed) {
      console.error('[parent-bot] Could not parse text mode JSON from:', raw);
      parsed = { kind: 'task', title: inputText, type: 'other' };
    }

    if (parsed.kind === 'schedule') {
      const row = {
        Subject:         parsed.subject || inputText,
        day_of_week:     parsed.day_of_week || 'Sunday',
        start_time:      parsed.start_time  || '08:00',
        endtime:         parsed.end_time    || '08:45',
        created_by_role: 'parent',
        user_id:         child_id,
        children_id:     child_id,
      };
      const rec = await metaInsert(metaToken, SCHEDULE_TABLE, row);
      if (!rec) return NextResponse.json({ reply: 'לא הצלחתי להוסיף את השיעור. נסה שוב.' });
      return NextResponse.json({ reply: `✅ נוסף שיעור קבוע: "${parsed.subject}" כל יום ${parsed.day_of_week} בשעה ${parsed.start_time}` });
    }

    // One-time task
    const due_ts = new Date(parsed.due_date || `${today}T15:00:00`).getTime();
    const row = {
      title:           parsed.title || inputText,
      type:            parsed.type  || 'homework',
      due_date:        due_ts,
      description:     parsed.description || '',
      child_id,
      status:          'pending',
      source:          'parent',
      created_by_role: 'parent',
    };
    const rec = await metaInsert(metaToken, TASK_TABLE, row);
    if (!rec) return NextResponse.json({ reply: 'לא הצלחתי להוסיף את המשימה. נסה שוב.' });

    const typeLabel: Record<string, string> = { test: 'מבחן', homework: 'שיעורי בית', activity: 'פעילות', other: 'משימה' };
    return NextResponse.json({ reply: `✅ נוספ${parsed.type === 'test' ? 'ה' : 'ו'} ${typeLabel[parsed.type] || 'משימה'}: "${parsed.title || inputText}"` });

  } catch (err) {
    console.error('[parent-bot] unhandled error:', err);
    return NextResponse.json({ reply: 'שגיאת שרת לא צפויה.' }, { status: 500 });
  }
}
