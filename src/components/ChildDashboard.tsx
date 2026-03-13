'use client';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const normalizeTasks = (arr: Task[]): Task[] => arr.map(t => ({
  ...t,
  due_date: t.due_date || (t.due_time ? Math.floor(new Date(t.due_time + 'T12:00:00').getTime() / 1000) : 0),
}));
const extractArray = (d: unknown): Task[] => {
  let arr: Task[] = [];
  if (Array.isArray(d)) arr = d;
  else if (d && typeof d === 'object') {
    const obj = d as Record<string, unknown>;
    if (Array.isArray(obj.items)) arr = obj.items as Task[];
    else if (Array.isArray(obj.value)) arr = obj.value as Task[];
    else if (Array.isArray(obj.result)) arr = obj.result as Task[];
  }
  return normalizeTasks(arr);
};

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, ChevronLeft, ChevronRight, Edit3,
  Bot, FileText, Star, Bell, UserPlus,
  X, Send, Upload, Paperclip, BookOpen, Sparkles, ExternalLink,
} from 'lucide-react';
import { API_URL, API_ENDPOINTS } from '@/lib/api';

interface Task {
  id: number;
  title: string;
  description: string;
  due_date: number;
  due_time?: string;
  status: 'pending' | 'in_progress' | 'done';
  type: 'homework' | 'test' | 'activity' | 'other' | 'school';
  _virtual?: boolean;
  _examId?: number;
  _slotId?: number;
}
interface Exam {
  id: number;
  exam_date: string;
  exam_time?: string;
  notes?: string;
  child_id?: number;
  subjects_id?: number;
}
interface ScheduleSlot {
  id: number;
  // Xano field name variants (defensive — exact name depends on API version)
  day_of_week?: string;
  dayofweek?: string;
  day?: string;
  Subject?: string;
  subject?: string;
  start_time?: string;
  startTime?: string;
  endtime?: string;
  end_time?: string;
  endTime?: string;
  children_id?: number;
  subjects_id?: number;
}

const DAY_OF_WEEK_NUM: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};
function parseTimeHour(t: string): number { return parseInt((t || '12').split(':')[0]) || 12; }
function toAnyArray(d: unknown): unknown[] {
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    return Array.isArray(o.items) ? o.items : Array.isArray(o.value) ? o.value : Array.isArray(o.result) ? o.result : [];
  }
  return [];
}
function examToTask(exam: Exam, days: Date[]): Task | null {
  if (!exam.exam_date) return null;
  const hour = exam.exam_time ? parseTimeHour(exam.exam_time) : 12;
  const due_date = tsFromDateAndHour(exam.exam_date, hour);
  return { id: -(exam.id * 1000 + 500), title: exam.notes || 'מבחן', description: exam.notes || '',
    due_date, status: 'pending', type: 'test', _virtual: true, _examId: exam.id };
}
function slotToTask(slot: ScheduleSlot, days: Date[]): Task | null {
  const dayOfWeek = slot.day_of_week || slot.dayofweek || slot.day || '';
  const subject   = slot.Subject || slot.subject || 'שיעור';
  const startTime = slot.start_time || slot.startTime || '';
  console.log('[schedule slot raw]', slot, '→', { dayOfWeek, subject, startTime });
  const dayNum = DAY_OF_WEEK_NUM[dayOfWeek];
  if (dayNum === undefined) return null;
  const date = days.find(d => d.getDay() === dayNum);
  if (!date) return null;
  const hour = parseTimeHour(startTime);
  const due_date = tsFromDateAndHour(dayStrOf(date), hour);
  const now = Math.floor(Date.now() / 1000);
  return { id: -(slot.id * 1000), title: subject, description: '',
    due_date, status: due_date < now ? 'done' : 'pending', type: 'school',
    _virtual: true, _slotId: slot.id };
}
interface Child { id: number; name: string; username: string; grade: string; }
interface ChatMessage { role: 'user' | 'bot'; text: string; }
interface StudySession { title: string; date: string; hour: number; }
interface PracticeLink { title: string; url: string; }
interface StudyPlan { reply: string; study_sessions?: StudySession[]; practice_links?: PracticeLink[]; }

const HEBREW_DAYS   = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const GRID_HOURS    = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const ROW_HEIGHT    = 56;
const CACHE_TTL     = 5 * 60 * 1000;

function weekStart(d: Date): Date {
  const r = new Date(d); r.setDate(r.getDate() - r.getDay()); r.setHours(0, 0, 0, 0); return r;
}
function weekDays(d: Date): Date[] {
  const s = weekStart(d);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(s); x.setDate(x.getDate() + i); return x; });
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function toAPIDate(d: Date) { return d.toISOString().split('T')[0]; }
function getTaskHour(ts: number): number { return new Date(ts * 1000).getHours(); }
function getTaskTimeLabel(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function tsFromDateAndHour(dateStr: string, hour: number): number {
  return Math.floor(new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00`).getTime() / 1000);
}
function dayStrOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function urgencyKey(ts: number, status: Task['status']): 'done' | 'overdue' | 'today' | 'tomorrow' | 'soon' | 'later' {
  if (status === 'done') return 'done';
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const due = new Date(ts * 1000); due.setHours(0, 0, 0, 0);
  const d = Math.round((due.getTime() - now.getTime()) / 86400000);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d <= 3) return 'soon';
  return 'later';
}

const TYPE_EMOJI: Record<Task['type'], string> = { homework: '📚', test: '📝', activity: '🎨', school: '🏫', other: '✏️' };

export default function ChildDashboard({ childId }: { childId: number }) {
  const { authToken } = useAuth();
  const router = useRouter();

  const [child, setChild] = useState<Child | null>(null);
  const [weekAllTasks, setWeekAllTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [currentDate, setCurrentDate] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const cacheRef = useRef<{ weekKey: string; fetchedAt: number } | null>(null);
  const calBodyRef = useRef<HTMLDivElement>(null);

  const [activeModal, setActiveModal] = useState<null | 'bot' | 'document' | 'compliment' | 'reminder' | 'secondary' | 'study-planner'>(null);
  const [upcomingTests, setUpcomingTests] = useState<Task[]>([]);
  const [selectedTest, setSelectedTest] = useState<Task | null>(null);
  const [studyPlan, setStudyPlan] = useState<StudyPlan | null>(null);
  const [studyPlanLoading, setStudyPlanLoading] = useState(false);
  const [studyPlanConfirmed, setStudyPlanConfirmed] = useState(false);

  // Bot
  const [botMessages, setBotMessages] = useState<ChatMessage[]>([
    { role: 'bot', text: 'שלום! תאר לי משימה ואני אדאג ליצור אותה. לדוגמה: "שיעורי בית במתמטיקה ליום שלישי"' },
  ]);
  const [botInput, setBotInput] = useState('');
  const [botLoading, setBotLoading] = useState(false);
  const [botFile, setBotFile] = useState<File | null>(null);
  const botFileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Modals
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState('');
  const [complimentText, setComplimentText] = useState('');
  const [reminderText, setReminderText] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  const [secondaryEmail, setSecondaryEmail] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [documentFile, setDocumentFile] = useState<File | null>(null);

  // Drag
  const [dragOverCell, setDragOverCell] = useState<{ di: number; hour: number } | null>(null);
  const dragTaskId = useRef<number | null>(null);

  const wDays = weekDays(currentDate);
  const today = new Date();

  // ─── Data fetching — tasks + exams + schedule slots ───────────────────────
  const fetchWeekData = useCallback(async (force = false) => {
    const days = weekDays(currentDate);
    const key = dayStrOf(days[0]);
    const now = Date.now();
    if (!force && cacheRef.current?.weekKey === key && now - cacheRef.current.fetchedAt < CACHE_TTL) return;
    setTasksLoading(true);
    const auth = { 'Authorization': `Bearer ${authToken}` };
    const start = dayStrOf(days[0]); const end = dayStrOf(days[6]);
    try {
      const [tasksRes, examsRes, slotsRes] = await Promise.all([
        fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.TASKS(childId)}?start=${start}&end=${end}`, { headers: auth }),
        fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.EXAMS(childId)}?start=${start}&end=${end}`, { headers: auth }).catch(() => null),
        fetch(`/api/parent-schedule?childId=${childId}`, { headers: auth }).catch(() => null),
      ]);
      const realTasks: Task[] = tasksRes.ok ? extractArray(await tasksRes.json()) : [];
      const examTasks: Task[] = examsRes?.ok
        ? (toAnyArray(await examsRes.json()) as Exam[]).flatMap(e => { const t = examToTask(e, days); return t ? [t] : []; })
        : [];
      const slotsRaw = slotsRes?.ok ? await slotsRes.json() : [];
      console.log('[fetchWeekData] raw schedule response:', slotsRaw);
      const slots: ScheduleSlot[] = toAnyArray(slotsRaw) as ScheduleSlot[];
      const slotTasks: Task[] = slots.flatMap(s => { const t = slotToTask(s, days); return t ? [t] : []; });
      setWeekAllTasks([...realTasks, ...examTasks, ...slotTasks]);
      cacheRef.current = { weekKey: key, fetchedAt: now };
    } catch { setWeekAllTasks([]); } finally { setTasksLoading(false); }
  }, [currentDate, childId, authToken]);

  useEffect(() => { fetchWeekData(); }, [fetchWeekData]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [botMessages]);
  useEffect(() => {
    if (calBodyRef.current) {
      const nowIdx = GRID_HOURS.indexOf(new Date().getHours());
      calBodyRef.current.scrollTop = Math.max(0, (nowIdx - 1) * ROW_HEIGHT);
    }
  }, [view]);

  async function fetchChild() {
    try {
      const res = await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.GET(childId)}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
      if (res.ok) setChild(await res.json());
    } catch {}
  }
  useEffect(() => { fetchChild(); }, [childId]);

  // ─── Upcoming tests (next 7 days) ─────────────────────────────────────────
  useEffect(() => {
    async function fetchUpcomingTests() {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const end = new Date(now); end.setDate(end.getDate() + 7);
      const start = toAPIDate(now);
      const endStr = toAPIDate(end);
      try {
        const res = await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.TASKS(childId)}?start=${start}&end=${endStr}`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (!res.ok) return;
        const all = extractArray(await res.json());
        const isTestTask = (t: Task) =>
          t.type === 'test' || /מבחן|בוחן|טסט|בחינה/.test(t.title);
        setUpcomingTests(all.filter(isTestTask).sort((a, b) => a.due_date - b.due_date));
      } catch {}
    }
    fetchUpcomingTests();
  }, [childId, authToken]);

  // ─── Actions ──────────────────────────────────────────────────────────────
  async function toggleTaskStatus(task: Task) {
    if (task._virtual) return;
    const next: Task['status'] = task.status === 'pending' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'pending';
    setWeekAllTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next } : t));
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.UPDATE_TASK(childId, task.id)}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
    } catch {}
  }

  async function moveTaskToDayHour(taskId: number, targetDay: Date, hour: number) {
    const task = weekAllTasks.find(t => t.id === taskId);
    if (!task || task._virtual) return;
    const mins = new Date(task.due_date * 1000).getMinutes();
    const newTs = tsFromDateAndHour(dayStrOf(targetDay), hour) + mins * 60;
    setWeekAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, due_date: newTs } : t));
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.UPDATE_TASK(childId, taskId)}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: newTs }),
      });
    } catch {}
  }

  const N8N_WEBHOOK = 'https://tahelblum.app.n8n.cloud/webhook/kidtime-bot';

  async function sendBotMessage() {
    if (!botInput.trim() || botLoading) return;
    const msg = botInput.trim(); setBotInput('');
    setBotMessages(prev => [...prev, { role: 'user', text: msg }]);
    setBotLoading(true);
    try {
      const res = await fetch(N8N_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, child_id: childId, auth_token: authToken }) });
      const data = await res.json();
      setBotMessages(prev => [...prev, { role: 'bot', text: data.reply || 'המשימה נוצרה בהצלחה!' }]);
      fetchWeekData(true);
    } catch { setBotMessages(prev => [...prev, { role: 'bot', text: 'מצטער, אירעה שגיאה. נסה שוב.' }]); }
    finally { setBotLoading(false); }
  }

  async function sendBotFile() {
    if (!botFile || botLoading) return;
    const file = botFile; setBotFile(null);
    setBotMessages(prev => [...prev, { role: 'user', text: `📎 ${file.name}` }]);
    setBotLoading(true);
    try {
      const text = (await file.text()).substring(0, 8000);
      const res = await fetch(N8N_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_content: text, child_id: childId, auth_token: authToken }) });
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      setBotMessages(prev => [...prev, { role: 'bot', text: data.reply || 'מעולה! המשימות נוספו מהמסמך! ✅' }]);
      fetchWeekData(true);
    } catch { setBotMessages(prev => [...prev, { role: 'bot', text: 'שגיאה בעיבוד הקובץ. נסה שוב.' }]); }
    finally { setBotLoading(false); }
  }

  async function sendCompliment() {
    if (!complimentText.trim()) return;
    setActionLoading(true);
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.COMPLIMENT(childId)}`, { method: 'POST', headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: complimentText }) });
      setActionSuccess('המחמאה נשלחה לילד!'); setComplimentText('');
    } catch { setActionSuccess(''); } finally { setActionLoading(false); }
  }

  async function sendReminder() {
    if (!reminderText.trim()) return;
    setActionLoading(true);
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.REMINDER(childId)}`, { method: 'POST', headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: reminderText, scheduled_at: reminderDate }) });
      setActionSuccess('התזכורת נשלחה בהצלחה!'); setReminderText(''); setReminderDate('');
    } catch { setActionSuccess(''); } finally { setActionLoading(false); }
  }

  async function addSecondaryParent() {
    if (!secondaryEmail.trim()) return;
    setActionLoading(true);
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.SECONDARY_PARENT(childId)}`, { method: 'POST', headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: secondaryEmail }) });
      setActionSuccess('הזמנה נשלחה להורה השני!'); setSecondaryEmail('');
    } catch { setActionSuccess(''); } finally { setActionLoading(false); }
  }

  async function submitDocument() {
    if (!documentText.trim() && !documentFile) return;
    setActionLoading(true);
    try {
      const formData = new FormData();
      formData.append('child_id', String(childId));
      if (documentFile) formData.append('file', documentFile);
      if (documentText) formData.append('text', documentText);
      await fetch(`${API_URL}${API_ENDPOINTS.TASKS.FROM_DOCUMENT}`, { method: 'POST', headers: { 'Authorization': `Bearer ${authToken}` }, body: formData });
      setActionSuccess('המסמך נטען ומשימות נוצרו בהצלחה!'); setDocumentText(''); setDocumentFile(null);
      fetchWeekData(true);
    } catch { setActionSuccess(''); } finally { setActionLoading(false); }
  }

  async function openStudyPlanner(test: Task) {
    setSelectedTest(test);
    setStudyPlan(null);
    setStudyPlanConfirmed(false);
    setActiveModal('study-planner');
    setStudyPlanLoading(true);
    const testDate = new Date(test.due_date * 1000).toISOString().split('T')[0];
    // Collect existing tasks for the next 7 days so LLM can avoid busy slots
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setDate(end.getDate() + 7);
    const busySlots = upcomingTests
      .concat(weekAllTasks)
      .filter(t => t.due_date * 1000 >= now.getTime() && t.due_date * 1000 <= end.getTime())
      .map(t => ({ title: t.title, date: new Date(t.due_date * 1000).toISOString().split('T')[0], hour: new Date(t.due_date * 1000).getHours() }));
    try {
      const res = await fetch('/api/study-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_title: test.title,
          test_date: testDate,
          busy_slots: busySlots,
        }),
      });
      const data = await res.json();
      setStudyPlan(data);
    } catch {
      setStudyPlan({ reply: 'שגיאה בקבלת תכנית לימוד. נסה שוב.' });
    } finally {
      setStudyPlanLoading(false);
    }
  }

  async function confirmStudyPlan() {
    if (!studyPlan?.study_sessions?.length || !selectedTest) return;
    setStudyPlanLoading(true);
    try {
      await Promise.all(studyPlan.study_sessions.map(session =>
        fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.TASKS(childId)}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: session.title,
            type: 'homework',
            status: 'pending',
            due_date: tsFromDateAndHour(session.date, session.hour),
          }),
        })
      ));
      setStudyPlanConfirmed(true);
      fetchWeekData(true);
    } catch {} finally { setStudyPlanLoading(false); }
  }

  function closeModal() { setActiveModal(null); setActionSuccess(''); setActionLoading(false); }

  const navDate = (delta: number) => setCurrentDate(prev => { const d = new Date(prev); d.setDate(d.getDate() + delta); return d; });

  const dateLabel = view === 'day'
    ? `${HEBREW_DAYS[currentDate.getDay()]}, ${currentDate.getDate()} ${HEBREW_MONTHS[currentDate.getMonth()]}`
    : `${wDays[0].getDate()}–${wDays[6].getDate()} ${HEBREW_MONTHS[wDays[6].getMonth()]}`;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <button className="btn-back" onClick={() => router.push('/dashboard')}>
          <ArrowRight size={20} />חזרה
        </button>
        {child && (
          <div className="child-header-info">
            <div className="child-avatar-sm">{child.name.charAt(0)}</div>
            <div>
              <div className="dashboard-user-name">{child.name}</div>
              <div className="dashboard-user-email">כיתה {child.grade}</div>
            </div>
          </div>
        )}
        <button className="btn-secondary" onClick={() => { setActionSuccess(''); setActiveModal('secondary'); }}>
          <UserPlus size={18} />הורה שני
        </button>
      </header>

      <main className="dashboard-main" style={{ paddingBottom: 120 }}>

        {/* ── CALENDAR CONTROLS ── */}
        <div className="calendar-controls">
          <div className="view-toggle">
            <button className={`view-btn${view === 'day' ? ' active' : ''}`} onClick={() => setView('day')}>יום</button>
            <button className={`view-btn${view === 'week' ? ' active' : ''}`} onClick={() => setView('week')}>שבוע</button>
          </div>
          <div className="kid-cal-nav">
            <button className="nav-arrow" onClick={() => navDate(view === 'week' ? -7 : -1)}><ChevronRight size={18} /></button>
            <span className="calendar-date-label">{dateLabel}</span>
            <button className="nav-arrow" onClick={() => navDate(view === 'week' ? 7 : 1)}><ChevronLeft size={18} /></button>
          </div>
          <button className="btn-today" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setCurrentDate(d); }}>היום</button>
        </div>

        {/* ── UPCOMING TESTS BANNER ── */}
        {upcomingTests.length > 0 && (
          <div className="upcoming-tests-banner">
            <div className="upcoming-tests-title">
              <BookOpen size={18} />
              מבחנים קרובים בשבוע הקרוב
            </div>
            {upcomingTests.map(test => {
              const daysLeft = Math.ceil((test.due_date * 1000 - Date.now()) / 86400000);
              const testDate = new Date(test.due_date * 1000);
              return (
                <div key={test.id} className="upcoming-test-row">
                  <div className="upcoming-test-info">
                    <span className="upcoming-test-name">📝 {test.title}</span>
                    <span className="upcoming-test-date">
                      {HEBREW_DAYS[testDate.getDay()]}, {testDate.getDate()} {HEBREW_MONTHS[testDate.getMonth()]}
                      {' · '}
                      <strong>{daysLeft === 0 ? 'היום!' : daysLeft === 1 ? 'מחר' : `בעוד ${daysLeft} ימים`}</strong>
                    </span>
                  </div>
                  <button className="btn-study-plan" onClick={() => openStudyPlanner(test)}>
                    <Sparkles size={15} />
                    תכנן לימוד
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── SMART CALENDAR ── */}
        {tasksLoading ? (
          <div className="tasks-loading"><div className="spinner" /></div>
        ) : (
          <div className="smart-cal-outer">
            {/* Column headers */}
            <div className="smart-cal-head">
              <div className="sc-corner" />
              {(view === 'day' ? [currentDate] : wDays).map((day, i) => {
                const isToday = sameDay(day, today);
                const dayDone  = weekAllTasks.filter(t => sameDay(new Date(t.due_date * 1000), day) && t.status === 'done').length;
                const dayTotal = weekAllTasks.filter(t => sameDay(new Date(t.due_date * 1000), day)).length;
                return (
                  <div key={i} className={`sc-day-head${isToday ? ' sc-today-head' : ''}`}
                    onClick={() => { setCurrentDate(day); if (view === 'week') setView('day'); }}>
                    <span className="sc-day-name">{HEBREW_DAYS[day.getDay()]}</span>
                    <span className={`sc-day-num${isToday ? ' sc-today-num' : ''}`}>{day.getDate()}</span>
                    {dayTotal > 0 && <span className="sc-day-prog">{dayDone}/{dayTotal}</span>}
                  </div>
                );
              })}
            </div>

            {/* Time grid body */}
            <div className="smart-cal-body" ref={calBodyRef}>
              {/* Now line */}
              {(() => {
                const now = new Date();
                const nowIdx = GRID_HOURS.indexOf(now.getHours());
                const showNow = view === 'day' ? sameDay(currentDate, today) : wDays.some(d => sameDay(d, today));
                if (!showNow || nowIdx < 0) return null;
                const top = nowIdx * ROW_HEIGHT + (now.getMinutes() / 60) * ROW_HEIGHT;
                return <div className="sc-now-line" style={{ top }} />;
              })()}

              {/* Tasks outside grid hours — shown at top so they're always visible */}
              {(() => {
                const calDays = view === 'day' ? [currentDate] : wDays;
                const out = weekAllTasks.filter(t =>
                  calDays.some(d => sameDay(new Date(t.due_date * 1000), d)) &&
                  !GRID_HOURS.includes(getTaskHour(t.due_date))
                );
                if (!out.length) return null;
                return (
                  <div className="sc-row sc-allday-row">
                    <div className="sc-time-label">📌</div>
                    <div className="sc-allday-tasks">
                      {out.map(task => {
                        const uk = urgencyKey(task.due_date, task.status);
                        return (
                          <div key={task.id}
                            className={`sc-event ev-${task.type} urgency-${uk}${task.status === 'done' ? ' ev-done' : ''}`}
                            onClick={() => toggleTaskStatus(task)}>
                            <span className="ev-emoji">{TYPE_EMOJI[task.type] ?? '✏️'}</span>
                            <span className={`ev-title${task.status === 'done' ? ' done' : ''}`}>{task.title}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {GRID_HOURS.map(hour => {
                const calDays = view === 'day' ? [currentDate] : wDays;
                return (
                  <div key={hour} className="sc-row">
                    <div className="sc-time-label">{String(hour).padStart(2, '0')}:00</div>
                    {calDays.map((day, di) => {
                      const isToday = sameDay(day, today);
                      const cellTasks = weekAllTasks
                        .filter(t => sameDay(new Date(t.due_date * 1000), day) && getTaskHour(t.due_date) === hour)
                        .sort((a, b) => a.due_date - b.due_date);
                      const isDragOver = dragOverCell?.di === di && dragOverCell?.hour === hour;
                      return (
                        <div key={di}
                          className={`sc-cell${isToday ? ' sc-today-col' : ''}${isDragOver ? ' sc-drag-over' : ''}`}
                          onDragOver={e => { e.preventDefault(); setDragOverCell({ di, hour }); }}
                          onDragLeave={() => setDragOverCell(null)}
                          onDrop={e => { e.preventDefault(); setDragOverCell(null); if (dragTaskId.current !== null) moveTaskToDayHour(dragTaskId.current, day, hour); }}>
                          {cellTasks.map(task => {
                            const uk = urgencyKey(task.due_date, task.status);
                            return (
                              <div key={task.id}
                                draggable
                                onDragStart={e => { e.dataTransfer.setData('text/plain', String(task.id)); dragTaskId.current = task.id; }}
                                onDragEnd={() => { dragTaskId.current = null; setDragOverCell(null); }}
                                className={`sc-event ev-${task.type} urgency-${uk}${task.status === 'done' ? ' ev-done' : ''}`}
                                onClick={e => { e.stopPropagation(); toggleTaskStatus(task); }}>
                                <span className="ev-emoji">{TYPE_EMOJI[task.type] ?? '✏️'}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span className={`ev-title${task.status === 'done' ? ' done' : ''}`}>{task.title}</span>
                                  <div className="ev-time">{getTaskTimeLabel(task.due_date)}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {weekAllTasks.filter(t => view === 'day' ? sameDay(new Date(t.due_date * 1000), currentDate) : true).length === 0 && (
                <div className="sc-empty">
                  <div style={{ fontSize: '2rem' }}>✅</div>
                  <div style={{ fontWeight: 700 }}>אין משימות לתקופה זו</div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ── FAB action bar ── */}
      <div className="fab-panel">
        <button className="fab-btn fab-bot" onClick={() => { setActionSuccess(''); setActiveModal('bot'); }}>
          <Bot size={22} /><span>בוט</span>
        </button>
        <button className="fab-btn fab-doc" onClick={() => { setActionSuccess(''); setActiveModal('document'); }}>
          <FileText size={22} /><span>מסמך</span>
        </button>
        <button className="fab-btn fab-star" onClick={() => { setActionSuccess(''); setActiveModal('compliment'); }}>
          <Star size={22} /><span>מחמאה</span>
        </button>
        <button className="fab-btn fab-bell" onClick={() => { setActionSuccess(''); setActiveModal('reminder'); }}>
          <Bell size={22} /><span>תזכורת</span>
        </button>
      </div>

      {/* ── Modals ── */}
      {activeModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}><X size={20} /></button>

            {/* Bot */}
            {activeModal === 'bot' && (
              <>
                <div className="modal-header">
                  <div className="modal-icon modal-icon-bot"><Bot size={28} color="white" /></div>
                  <h2 className="modal-title">הוסף משימה עם בוט</h2>
                  <p className="modal-sub">תאר את המשימה בשפה טבעית</p>
                </div>
                <div className="chat-window">
                  {botMessages.map((msg, i) => (
                    <div key={i} className={`chat-bubble chat-bubble-${msg.role}`}><span>{msg.text}</span></div>
                  ))}
                  {botLoading && <div className="chat-bubble chat-bubble-bot"><span className="typing-dots"><span>.</span><span>.</span><span>.</span></span></div>}
                  <div ref={chatEndRef} />
                </div>
                {botFile && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--color-bg)', borderRadius: 8, margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--color-primary)' }}>
                    <Paperclip size={14} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{botFile.name}</span>
                    <button onClick={() => setBotFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><X size={14} /></button>
                  </div>
                )}
                <div className="chat-input-row">
                  <input ref={botFileRef} type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" style={{ display: 'none' }}
                    onChange={e => { setBotFile(e.target.files?.[0] || null); if (botFileRef.current) botFileRef.current.value = ''; }} />
                  <button className="chat-send" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}
                    onClick={() => botFileRef.current?.click()} disabled={botLoading} title="צרף קובץ">
                    <Paperclip size={18} />
                  </button>
                  <input type="text" className="chat-input" placeholder="לדוגמה: שיעורי בית במתמטיקה ליום שני..."
                    value={botInput} onChange={e => setBotInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (botFile ? sendBotFile() : sendBotMessage())} />
                  <button className="chat-send" onClick={botFile ? sendBotFile : sendBotMessage} disabled={botLoading}><Send size={18} /></button>
                </div>
              </>
            )}

            {/* Document */}
            {activeModal === 'document' && (
              <>
                <div className="modal-header">
                  <div className="modal-icon modal-icon-doc"><FileText size={28} color="white" /></div>
                  <h2 className="modal-title">טעינת מסמך</h2>
                  <p className="modal-sub">העלו קובץ או הדביקו טקסט לייצור משימות</p>
                </div>
                {actionSuccess ? <div className="success-box">{actionSuccess}</div> : (
                  <>
                    <div className="upload-area" onClick={() => document.getElementById('file-upload-cd')?.click()}>
                      <Upload size={32} color="var(--color-primary)" />
                      <p>{documentFile ? documentFile.name : 'לחץ להעלאת קובץ (PDF, Word, תמונה)'}</p>
                      <input id="file-upload-cd" type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" style={{ display: 'none' }} onChange={e => setDocumentFile(e.target.files?.[0] || null)} />
                    </div>
                    <div className="modal-divider">או</div>
                    <div className="form-field">
                      <label>הדבק טקסט</label>
                      <textarea className="form-textarea" value={documentText} onChange={e => setDocumentText(e.target.value)} placeholder="הדבק כאן שיעורי בית, רשימת משימות..." rows={4} />
                    </div>
                    <button className="btn-primary" onClick={submitDocument} disabled={actionLoading || (!documentText.trim() && !documentFile)}>
                      {actionLoading ? 'טוען...' : 'צור משימות מהמסמך'}
                    </button>
                  </>
                )}
              </>
            )}

            {/* Compliment */}
            {activeModal === 'compliment' && (
              <>
                <div className="modal-header">
                  <div className="modal-icon modal-icon-star"><Star size={28} color="white" /></div>
                  <h2 className="modal-title">שלח מחמאה ל{child?.name}</h2>
                  <p className="modal-sub">עודד את הילד שלך בדרך חיובית</p>
                </div>
                {actionSuccess ? <div className="success-box">{actionSuccess}</div> : (
                  <>
                    <div className="quick-chips">
                      {['כל הכבוד! 🌟', 'עבודה מצוינת! ⭐', 'אני גאה בך! 💫', 'המשך כך! 💪', 'אתה מדהים! 🎉'].map(c => (
                        <button key={c} className="chip" onClick={() => setComplimentText(c)}>{c}</button>
                      ))}
                    </div>
                    <div className="form-field" style={{ marginTop: 16 }}>
                      <label>מחמאה אישית</label>
                      <textarea className="form-textarea" value={complimentText} onChange={e => setComplimentText(e.target.value)} placeholder="כתוב מחמאה אישית..." rows={3} />
                    </div>
                    <button className="btn-primary" onClick={sendCompliment} disabled={actionLoading || !complimentText.trim()}>
                      {actionLoading ? 'שולח...' : 'שלח מחמאה'}
                    </button>
                  </>
                )}
              </>
            )}

            {/* Reminder */}
            {activeModal === 'reminder' && (
              <>
                <div className="modal-header">
                  <div className="modal-icon modal-icon-bell"><Bell size={28} color="white" /></div>
                  <h2 className="modal-title">שלח תזכורת ל{child?.name}</h2>
                  <p className="modal-sub">שלח תזכורת לגבי משימה או פעילות</p>
                </div>
                {actionSuccess ? <div className="success-box">{actionSuccess}</div> : (
                  <>
                    <div className="quick-chips">
                      {['אל תשכח שיעורי בית!', 'זמן ללמוד!', 'יש משימה שמחכה לך'].map(c => (
                        <button key={c} className="chip" onClick={() => setReminderText(c)}>{c}</button>
                      ))}
                    </div>
                    <div className="form-field" style={{ marginTop: 16 }}>
                      <label>תוכן התזכורת</label>
                      <textarea className="form-textarea" value={reminderText} onChange={e => setReminderText(e.target.value)} placeholder="לדוגמה: אל תשכח לסיים שיעורי הבית!" rows={3} />
                    </div>
                    <div className="form-field">
                      <label>תאריך ושעה (אופציונלי)</label>
                      <input type="datetime-local" className="form-select" value={reminderDate} onChange={e => setReminderDate(e.target.value)} />
                    </div>
                    <button className="btn-primary" onClick={sendReminder} disabled={actionLoading || !reminderText.trim()}>
                      {actionLoading ? 'שולח...' : 'שלח תזכורת'}
                    </button>
                  </>
                )}
              </>
            )}

            {/* Study Planner */}
            {activeModal === 'study-planner' && selectedTest && (
              <>
                <div className="modal-header">
                  <div className="modal-icon" style={{ background: 'linear-gradient(135deg, #6C63FF, #74B9FF)' }}>
                    <Sparkles size={28} color="white" />
                  </div>
                  <h2 className="modal-title">תכנית לימוד חכמה</h2>
                  <p className="modal-sub">{selectedTest.title}</p>
                </div>
                {studyPlanConfirmed ? (
                  <div className="success-box">תכנית הלימוד נוספה ללוח הזמנים! 🎉</div>
                ) : studyPlanLoading ? (
                  <div className="study-plan-loading">
                    <div className="spinner" />
                    <p>מנתח זמינות וחיפוש תרגולים... ✨</p>
                  </div>
                ) : studyPlan ? (
                  <>
                    <div className="study-plan-reply">{studyPlan.reply}</div>

                    {studyPlan.study_sessions && studyPlan.study_sessions.length > 0 && (
                      <div className="study-sessions-list">
                        <div className="study-sessions-title">סשנים מומלצים:</div>
                        {studyPlan.study_sessions.map((s, i) => {
                          const d = new Date(`${s.date}T${String(s.hour).padStart(2, '0')}:00:00`);
                          return (
                            <div key={i} className="study-session-row">
                              <span className="study-session-icon">📅</span>
                              <div>
                                <div className="study-session-title">{s.title}</div>
                                <div className="study-session-time">
                                  {HEBREW_DAYS[d.getDay()]}, {d.getDate()} {HEBREW_MONTHS[d.getMonth()]} · {String(s.hour).padStart(2, '0')}:00
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {studyPlan.practice_links && studyPlan.practice_links.length > 0 && (
                      <div className="practice-links-list">
                        <div className="study-sessions-title">תרגולים מהרשת:</div>
                        {studyPlan.practice_links.map((link, i) => (
                          <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="practice-link-row">
                            <ExternalLink size={14} />
                            {link.title}
                          </a>
                        ))}
                      </div>
                    )}

                    {studyPlan.study_sessions && studyPlan.study_sessions.length > 0 && (
                      <button className="btn-primary" onClick={confirmStudyPlan} disabled={studyPlanLoading}>
                        הוסף ללוח הזמנים
                      </button>
                    )}
                  </>
                ) : null}
              </>
            )}

            {/* Secondary parent */}
            {activeModal === 'secondary' && (
              <>
                <div className="modal-header">
                  <div className="modal-icon modal-icon-parent"><UserPlus size={28} color="white" /></div>
                  <h2 className="modal-title">הוסף הורה שני</h2>
                  <p className="modal-sub">שלח הזמנה להורה שני לנהל את {child?.name}</p>
                </div>
                {actionSuccess ? <div className="success-box">{actionSuccess}</div> : (
                  <>
                    <div className="form-field">
                      <label>אימייל ההורה השני</label>
                      <input type="email" className="form-select" value={secondaryEmail} onChange={e => setSecondaryEmail(e.target.value)} placeholder="parent@email.com" />
                    </div>
                    <button className="btn-primary" onClick={addSecondaryParent} disabled={actionLoading || !secondaryEmail.trim()}>
                      {actionLoading ? 'שולח...' : 'שלח הזמנה'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
