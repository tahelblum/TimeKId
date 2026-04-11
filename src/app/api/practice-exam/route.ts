import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = (grade: string) =>
  `You are an experienced Israeli school teacher creating a practice exam in Hebrew.
The student is in grade ${grade}.
Generate 6 practice questions appropriate for this grade level based on the provided material.

Use a mix of types:
- multiple_choice (בחירה מרובה) — 4 options labeled א/ב/ג/ד
- short_answer (תשובה קצרה) — 1-2 sentence answer
- fill_blank (השלמת משפט) — sentence with ___ to fill in

Rules:
- All questions and answers in Hebrew
- Match difficulty to grade ${grade}
- Questions must be directly based on the provided material
- For multiple_choice, exactly 4 options, answer is the letter (א/ב/ג/ד)

Return ONLY a raw JSON array, no markdown, no explanation:
[
  { "type": "multiple_choice", "question": "...", "options": ["א. ...", "ב. ...", "ג. ...", "ד. ..."], "answer": "א" },
  { "type": "short_answer", "question": "...", "answer": "..." },
  { "type": "fill_blank", "question": "המשפט עם ___ להשלמה", "answer": "המילה החסרה" }
]`;

export interface PracticeQuestion {
  type: 'multiple_choice' | 'short_answer' | 'fill_blank';
  question: string;
  options?: string[];
  answer: string;
}

export async function POST(req: NextRequest) {
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) return NextResponse.json({ error: 'מפתח AI חסר בשרת' }, { status: 500 });

    const { material, subject, grade } = await req.json() as {
      material?: string;
      subject?: string;
      grade?: string;
    };

    if (!material?.trim() && !subject?.trim()) {
      return NextResponse.json({ error: 'נא להזין חומר לימוד או נושא' }, { status: 400 });
    }

    const userPrompt = [
      subject ? `מקצוע: ${subject}` : '',
      material ? `חומר הלימוד:\n${material}` : '',
    ].filter(Boolean).join('\n');

    const aiRes = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: SYSTEM_PROMPT(grade || '5'),
        messages: [{ role: 'user', content: `צור שאלות תרגול עבור:\n${userPrompt}` }],
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      console.error('[practice-exam] AI error:', aiRes.status, err.substring(0, 200));
      return NextResponse.json({ error: `שגיאת AI (${aiRes.status})` }, { status: 500 });
    }

    const aiData = await aiRes.json();
    const raw = (aiData?.content?.[0]?.text ?? '').trim();
    console.log('[practice-exam] raw:', raw.substring(0, 400));

    let questions: PracticeQuestion[] = [];
    try {
      const cleaned = raw.replace(/```(?:json)?\n?/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) questions = JSON.parse(match[0]);
    } catch (e) {
      console.error('[practice-exam] parse error:', e);
      return NextResponse.json({ error: 'לא הצלחתי לייצר שאלות. נסה שנית.' }, { status: 422 });
    }

    if (!questions.length) return NextResponse.json({ error: 'לא נוצרו שאלות. נסה שנית.' }, { status: 422 });

    return NextResponse.json({ questions });
  } catch (err) {
    console.error('[practice-exam] unhandled:', err);
    return NextResponse.json({ error: 'שגיאת שרת' }, { status: 500 });
  }
}
