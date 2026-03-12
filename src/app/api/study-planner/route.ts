import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

interface BusySlot { title: string; date: string; hour: number; }

export async function POST(req: NextRequest) {
  const { test_title, test_date, busy_slots = [] } = await req.json() as {
    test_title: string;
    test_date: string;
    busy_slots: BusySlot[];
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due      = new Date(test_date + 'T00:00:00');
  const daysLeft = Math.ceil((due.getTime() - today.getTime()) / 86400000);

  const busyText = busy_slots.length
    ? busy_slots.map(s => `- ${s.title}: ${s.date} שעה ${s.hour}:00`).join('\n')
    : 'אין משימות קיימות';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: `אתה עוזר לימודי חכם לילדים בישראל.
המשימה שלך: לתכנן תכנית לימוד לקראת מבחן ולהמליץ על משאבי תרגול.
הנחיות לתכנית הלימוד:
- הצע 3–5 סשני לימוד (45–60 דקות כל אחד) בין היום לתאריך המבחן
- שעות מועדפות: 15:00–20:00, בימי חול בלבד (לא שישי ושבת)
- הימנע משעות שבהן כבר יש משימה קיימת
- כל סשן יכלול נושא ספציפי ומפורט
הנחיות לתרגולים:
- הצע 3–4 חיפושים רלוונטיים בגוגל שיעזרו למצוא תרגולים
- התאם לתכנית הלימודים הישראלית
- שפה עברית, ידידותית לילדים`,
      messages: [{
        role: 'user',
        content: `מבחן: ${test_title}
תאריך המבחן: ${test_date} (עוד ${daysLeft} ימים)
היום: ${today.toISOString().split('T')[0]}

משימות קיימות שיש להימנע מהן:
${busyText}

השב בפורמט JSON בלבד, כך:
{
  "reply": "הסבר קצר וידידותי על התכנית",
  "study_sessions": [
    { "title": "שם הסשן", "date": "YYYY-MM-DD", "hour": 16 }
  ],
  "practice_searches": [
    "שאילתת חיפוש בגוגל לתרגול"
  ]
}`,
      }],
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ reply: 'שגיאה בקבלת תכנית לימוד. נסה שוב.' }, { status: 500 });
  }

  const data     = await res.json();
  const rawText  = data?.content?.[0]?.text ?? '';

  let reply           = 'לא ניתן היה לבנות תכנית לימוד. נסה שוב.';
  let study_sessions: { title: string; date: string; hour: number }[] = [];
  let practice_links: { title: string; url: string }[] = [];

  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed            = JSON.parse(match[0]);
      reply                   = parsed.reply            ?? reply;
      study_sessions          = parsed.study_sessions   ?? [];
      const searches: string[] = parsed.practice_searches ?? [];
      practice_links = searches.map(q => ({
        title: q,
        url:   `https://www.google.com/search?q=${encodeURIComponent(q)}`,
      }));
    }
  } catch {
    reply = rawText || reply;
  }

  return NextResponse.json({ reply, study_sessions, practice_links });
}
