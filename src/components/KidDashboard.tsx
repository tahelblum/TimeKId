'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useChildAuth } from '@/contexts/ChildAuthContext';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2, Circle, Clock, X, Send,
  Bot, ChevronLeft, ChevronRight,
  Edit3, LogOut, BookOpen, Zap, Play, Pause, Target, Upload, FileText,
} from 'lucide-react';
import { API_URL, API_ENDPOINTS } from '@/lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const NOW_S = () => Math.floor(Date.now() / 1000);
const MAX_FUTURE_S = 10 * 365 * 24 * 3600; // 10 years in seconds — anything beyond is likely corrupted
const normalizeTasks = (arr: Task[]): Task[] => arr.map(t => {
  let due = t.due_date;
  if (!due && t.due_time) due = Math.floor(new Date(t.due_time + 'T12:00:00').getTime() / 1000);
  // Xano returns timestamps in milliseconds; convert to seconds for all calendar math
  if (due && due > 1e10) due = Math.floor(due / 1000);
  // If still unreasonably far in the future (unit mismatch / AI hallucination), reset to today
  if (due && due - NOW_S() > MAX_FUTURE_S) due = NOW_S();
  return { ...t, due_date: due || 0 };
});
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

// ─── Types ────────────────────────────────────────────────────────────────────
interface Task {
  id: number;
  title: string;
  description: string;
  due_date: number;
  due_time?: string; // YYYY-MM-DD, fallback for old records where due_date is null
  status: 'pending' | 'in_progress' | 'done';
  type: 'homework' | 'test' | 'activity' | 'other' | 'school' | 'holiday';
  _virtual?: boolean;  // true = display-only (schedule slot / exam), no PATCH
  _examId?: number;
  _slotId?: number;
}
interface Exam {
  id: number;
  exam_date: string;   // YYYY-MM-DD
  exam_time?: string;  // HH:MM
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
interface Holiday {
  id: number;
  name: string;
  start_date: string;  // YYYY-MM-DD
  end_date?: string;   // YYYY-MM-DD
  holiday_type?: string;
}
interface ChatMessage { role: 'user' | 'bot'; text: string; }

// ─── Multi-source calendar helpers ────────────────────────────────────────────
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_OF_WEEK_NUM: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};
function parseTimeHour(t: string): number {
  const parts = (t || '12:00').split(':');
  const h = parseInt(parts[0]) || 12;
  const m = parseInt(parts[1]) || 0;
  return m >= 30 ? h + 1 : h; // round so 8:55→9, 9:50→10, prevents same-hour collisions
}
function toAnyArray(d: unknown): unknown[] {
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    return (Array.isArray(o.items) ? o.items : Array.isArray(o.value) ? o.value : Array.isArray(o.result) ? o.result : []);
  }
  return [];
}
function examToTask(exam: Exam, days: Date[]): Task | null {
  if (!exam.exam_date) return null;
  const hour = exam.exam_time ? parseTimeHour(exam.exam_time) : 12;
  const due_date = tsFromDateAndHour(exam.exam_date, hour);
  const now = Math.floor(Date.now() / 1000);
  const status = due_date < now ? 'done' : 'pending';
  return { id: -(exam.id * 1000 + 500), title: exam.notes || 'מבחן', description: exam.notes || '',
    due_date, status, type: 'test', _virtual: true, _examId: exam.id };
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
function holidayToTasks(holiday: Holiday, days: Date[]): Task[] {
  if (!holiday.start_date) return [];
  const start = new Date(holiday.start_date + 'T00:00:00');
  const end = holiday.end_date ? new Date(holiday.end_date + 'T00:00:00') : start;
  return days
    .filter(d => d >= start && d <= end)
    .map(d => ({
      id: -(holiday.id * 100000 + d.getDay()),
      title: '🎉 ' + holiday.name,
      description: holiday.holiday_type || '',
      due_date: tsFromDateAndHour(dayStrOf(d), 0), // hour 0 = all-day (outside GRID_HOURS)
      status: 'pending' as const,
      type: 'holiday' as const,
      _virtual: true,
    }));
}

// ─── Calendar / school constants ──────────────────────────────────────────────
const GRID_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const SCHOOL_PERIODS = [7, 8, 9, 10, 11, 12, 13, 14, 15];
const SCHOOL_DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

// ─── Constants ────────────────────────────────────────────────────────────────
const ENCOURAGING = [
  'אתה פגז! 🔥', 'מדהים! המשך כך! ⭐', 'כל הכבוד! 🏆',
  'וואו! איזה הישג! 🎯', 'אתה מדהים! 💫', 'ניצחון! 🥇', 'סופר! 🎉',
  'אחד על אחד! 💪', 'פאנטסטי! ✨',
];
const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const FOCUS_MINUTES = 25;
const TIMER_CIRCUMFERENCE = 2 * Math.PI * 54; // r=54

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
function isTest(t: Task) {
  return t.type === 'test' || ['מבחן', 'בוחן', 'טסט', 'בחינה'].some(k => t.title.includes(k));
}
function daysUntil(ts: number): number {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const due = new Date(ts * 1000); due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / 86400000);
}
function tsFromDateStr(s: string) { return Math.floor(new Date(s + 'T12:00:00').getTime() / 1000); }
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
function dateStrFromTs(ts: number) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function urgencyKey(ts: number, status: Task['status']): 'done' | 'overdue' | 'today' | 'tomorrow' | 'soon' | 'later' {
  if (status === 'done') return 'done';
  if (!ts) return 'later'; // no valid date — treat as non-urgent
  const d = daysUntil(ts);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d <= 3) return 'soon';
  return 'later';
}
function relativeDate(ts: number): string {
  if (!ts) return '📅 ללא תאריך';
  const d = daysUntil(ts);
  if (d < 0) return `⚠️ באיחור של ${-d} ${-d === 1 ? 'יום' : 'ימים'}`;
  if (d === 0) return '🔴 היום!';
  if (d === 1) return '🟡 מחר';
  if (d === 2) return '🟢 עוד יומיים';
  return `🟢 עוד ${d} ימים`;
}
function sortByUrgency(tasks: Task[]): Task[] {
  const order = { overdue: 0, today: 1, tomorrow: 2, soon: 3, later: 4, done: 5 };
  return [...tasks].sort((a, b) => {
    const ka = urgencyKey(a.due_date, a.status);
    const kb = urgencyKey(b.due_date, b.status);
    if (order[ka] !== order[kb]) return order[ka] - order[kb];
    return a.due_date - b.due_date;
  });
}

// ─── Points / Streak helpers (localStorage) ──────────────────────────────────
function loadPoints(): number { return parseInt(localStorage.getItem('kid_points') || '0'); }
function loadStreak(): number {
  const raw = localStorage.getItem('kid_streak');
  if (!raw) return 0;
  try {
    const { lastDate, count } = JSON.parse(raw);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    if (lastDate === new Date().toDateString() || lastDate === yesterday.toDateString()) return count;
  } catch { /* corrupted data */ }
  return 0;
}
function earnPoints(n: number): number {
  const next = loadPoints() + n;
  localStorage.setItem('kid_points', String(next));
  return next;
}
function updateStreak(): number {
  const today = new Date().toDateString();
  const raw = localStorage.getItem('kid_streak');
  const prev = raw ? JSON.parse(raw) : { lastDate: '', count: 0 };
  if (prev.lastDate === today) return prev.count;
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const next = prev.lastDate === yesterday.toDateString() ? prev.count + 1 : 1;
  localStorage.setItem('kid_streak', JSON.stringify({ lastDate: today, count: next }));
  return next;
}

// Module-level cache for the logged-in child (single child per session)
interface KidDataCache {
  tasks: Task[];
  exams: Exam[];
  slots: ScheduleSlot[];
  holidays: Holiday[];
  fetchedAt: number;
}
let kidDataCache: KidDataCache | null = null;
const KID_CACHE_TTL = 30 * 60 * 1000; // 30 min

// ─── Component ────────────────────────────────────────────────────────────────
export default function KidDashboard() {
  const { child, authToken, logout } = useChildAuth();
  const router = useRouter();

  // Tasks & view
  const [tasksLoading, setTasksLoading] = useState(true);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [currentDate, setCurrentDate] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });

  // Single source of truth — all tasks for the currently viewed week
  const [weekAllTasks, setWeekAllTasks] = useState<Task[]>([]);
  // All real (non-virtual) tasks ever fetched — persists across week navigation
  const [allRealTasksState, setAllRealTasksState] = useState<Task[]>([]);
  // Schedule slots (recurring weekly) — stored separately for modal pre-population
  const [scheduleSlots, setScheduleSlots] = useState<ScheduleSlot[]>([]);

  // Cache tracking


  // Gamification
  const [points, setPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  useEffect(() => { setPoints(loadPoints()); setStreak(loadStreak()); }, []);

  // Celebration
  const [celebration, setCelebration] = useState<Task | null>(null);
  const [celebMsg] = useState(() => ENCOURAGING[Math.floor(Math.random() * ENCOURAGING.length)]);
  useEffect(() => {
    if (celebration) { const t = setTimeout(() => setCelebration(null), 3200); return () => clearTimeout(t); }
  }, [celebration]);

  // Focus timer
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const [focusSec, setFocusSec] = useState(FOCUS_MINUTES * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [focusDone, setFocusDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (focusRunning && focusSec > 0) {
      timerRef.current = setInterval(() => {
        setFocusSec(s => { if (s <= 1) { setFocusRunning(false); setFocusDone(true); return 0; } return s - 1; });
      }, 1000);
    } else { if (timerRef.current) clearInterval(timerRef.current); }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [focusRunning]);

  // Edit task
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', due_date: '', type: 'homework' as Task['type'] });
  const [editLoading, setEditLoading] = useState(false);

  // Study scheduler
  const [schedulerTest, setSchedulerTest] = useState<Task | null>(null);
  const [studySessions, setStudySessions] = useState<string[]>([]);
  const [studyMaterial, setStudyMaterial] = useState('');
  const [schedulerLoading, setSchedulerLoading] = useState(false);

  // Practice exam
  type PracticeQuestion = { type: 'multiple_choice' | 'short_answer' | 'fill_blank'; question: string; options?: string[]; answer: string };
  const [practiceExam, setPracticeExam] = useState<{ subject: string; questions: PracticeQuestion[] } | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceError, setPracticeError] = useState('');
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [showAnswers, setShowAnswers] = useState(false);

  // Chat
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'bot', text: 'שלום! ספר לי מה צריך לעשות ואני אוסיף לרשימה שלך 📚' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // School schedule
  const [showSchoolModal, setShowSchoolModal] = useState(false);
  const [schoolGrid, setSchoolGrid] = useState<Record<string, string>>({});
  const [schoolLoading, setSchoolLoading] = useState(false);
  const [schoolText, setSchoolText] = useState('');
  const [schoolParseError, setSchoolParseError] = useState('');
  const [schoolDebug, setSchoolDebug] = useState('');
  const schoolFileRef = useRef<HTMLInputElement>(null);

  // Exams modal
  const [showExamsModal, setShowExamsModal] = useState(false);
  const [examsText, setExamsText] = useState('');
  const [examsLoading, setExamsLoading] = useState(false);
  const [examsResult, setExamsResult] = useState('');
  const examsFileRef = useRef<HTMLInputElement>(null);

  // Drag & drop
  const [dragOverCell, setDragOverCell] = useState<{ di: number; hour: number } | null>(null);
  const dragTaskId = useRef<number | null>(null);

  // Completed tasks list toggle
  const [showDone, setShowDone] = useState(false);

  // Quick-add task by clicking a calendar cell
  const [addTaskCell, setAddTaskCell] = useState<{ day: Date; hour: number } | null>(null);
  const [addTaskTitle, setAddTaskTitle] = useState('');
  const [addTaskType, setAddTaskType] = useState<Task['type']>('homework');
  const [addTaskLoading, setAddTaskLoading] = useState(false);

  // Calendar body ref for scrolling to current hour
  const calBodyRef = useRef<HTMLDivElement>(null);
  const ROW_HEIGHT = 56;

  // In-flight guard — prevents concurrent Xano fetches
  const fetchInFlight = useRef(false);

  // ─── Data fetching — fetch once per session, filter client-side per week ────
  function applyWeekView(cached: KidDataCache, days: Date[]) {
    // Build set of holiday date strings so we can suppress school slots on those days
    const holidayDates = new Set<string>();
    cached.holidays.forEach(h => {
      if (!h.start_date) return;
      const start = new Date(h.start_date + 'T00:00:00');
      const end = h.end_date ? new Date(h.end_date + 'T00:00:00') : start;
      days.forEach(d => { if (d >= start && d <= end) holidayDates.add(dayStrOf(d)); });
    });

    const examTasks: Task[] = cached.exams.flatMap(e => { const t = examToTask(e, days); return t ? [t] : []; });
    setScheduleSlots(cached.slots);
    const slotTasks: Task[] = cached.slots.flatMap(s => {
      const t = slotToTask(s, days);
      // Drop slot if it falls on a holiday
      if (t && holidayDates.has(dateStrFromTs(t.due_date))) return [];
      return t ? [t] : [];
    });
    const holidayTasks: Task[] = cached.holidays.flatMap(h => holidayToTasks(h, days));
    setWeekAllTasks([...cached.tasks, ...examTasks, ...slotTasks, ...holidayTasks]);
    // Keep the full real-task list stable across week navigation
    setAllRealTasksState(sortByUrgency(cached.tasks));
  }

  // fetchWeekData: makes API calls at most once per KID_CACHE_TTL.
  // Does NOT depend on currentDate — navigation is handled by the separate effect below.
  const fetchWeekData = useCallback(async (force = false) => {
    if (fetchInFlight.current && !force) return; // block concurrent calls
    const now = Date.now();
    if (force) kidDataCache = null;

    if (kidDataCache && now - kidDataCache.fetchedAt < KID_CACHE_TTL) {
      // Cache still valid — just re-apply for the current week (no API calls)
      applyWeekView(kidDataCache, weekDays(currentDate));
      return;
    }

    fetchInFlight.current = true;
    setTasksLoading(true);
    const auth = { Authorization: `Bearer ${authToken}` };
    try {
      const [tasksRes, examsRes, slotsRes, holidaysRes] = await Promise.all([
        fetch(`${API_URL}${API_ENDPOINTS.CHILD.MY_TASKS}`, { headers: auth }),
        fetch(`${API_URL}${API_ENDPOINTS.CHILD.EXAMS}`, { headers: auth }).catch(() => null),
        fetch(`${API_URL}${API_ENDPOINTS.CHILD.SCHEDULE}`, { headers: auth }).catch(() => null),
        fetch(`${API_URL}${API_ENDPOINTS.CHILD.HOLIDAYS}`, { headers: auth }).catch(() => null),
      ]);
      if (tasksRes.status === 401) { logout(); router.push('/child-app'); return; }
      const tasks: Task[]         = tasksRes.ok    ? extractArray(await tasksRes.json())             : [];
      const exams: Exam[]         = examsRes?.ok   ? toAnyArray(await examsRes.json()) as Exam[]    : [];
      const slots: ScheduleSlot[] = slotsRes?.ok   ? toAnyArray(await slotsRes.json()) as ScheduleSlot[] : [];
      const holidays: Holiday[]   = holidaysRes?.ok ? toAnyArray(await holidaysRes.json()) as Holiday[] : [];
      kidDataCache = { tasks, exams, slots, holidays, fetchedAt: now };
      applyWeekView(kidDataCache, weekDays(currentDate));
    } catch {} finally { setTasksLoading(false); fetchInFlight.current = false; }
  }, [authToken]); // ← currentDate removed: navigation never triggers API calls

  // Initial fetch on mount / auth change
  useEffect(() => { fetchWeekData(); }, [fetchWeekData]);

  // Week navigation: re-apply cached data client-side, no API call
  useEffect(() => {
    if (kidDataCache) applyWeekView(kidDataCache, weekDays(currentDate));
  }, [currentDate]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);
  useEffect(() => {
    if (calBodyRef.current) {
      const nowIdx = GRID_HOURS.indexOf(new Date().getHours());
      calBodyRef.current.scrollTop = Math.max(0, (nowIdx - 1) * ROW_HEIGHT);
    }
  }, [view]);

  // Auto-complete school tasks whose time has passed
  useEffect(() => {
    const autoComplete = () => {
      const now = Math.floor(Date.now() / 1000);
      setWeekAllTasks(prev => {
        const toComplete = prev.filter(t => t.type === 'school' && !t._virtual && t.status !== 'done' && t.due_date < now);
        if (!toComplete.length) return prev;
        toComplete.forEach(task => {
          fetch(`${API_URL}${API_ENDPOINTS.CHILD.UPDATE_TASK(task.id)}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'done' }),
          }).catch(() => {});
        });
        return prev.map(t => toComplete.some(c => c.id === t.id) ? { ...t, status: 'done' } : t);
      });
    };
    autoComplete();
    const interval = setInterval(autoComplete, 60000);
    return () => clearInterval(interval);
  }, [authToken]);

  // ─── Actions ───────────────────────────────────────────────────────────────
  async function toggleStatus(task: Task) {
    if (task._virtual) return;
    const next: Task['status'] = task.status === 'pending' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'pending';
    setWeekAllTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next } : t));
    setAllRealTasksState(prev => sortByUrgency(prev.map(t => t.id === task.id ? { ...t, status: next } : t)));
    if (next === 'done') {
      setCelebration(task);
      const newPoints = earnPoints(10);
      const newStreak = updateStreak();
      setPoints(newPoints);
      setStreak(newStreak);
    }
    try {
      const res = await fetch(`${API_URL}${API_ENDPOINTS.CHILD.UPDATE_TASK(task.id)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (res.status === 401) { logout(); router.push('/child-app'); }
    } catch {}
  }

  function openFocus(task: Task, e?: React.MouseEvent) {
    e?.stopPropagation();
    setFocusTask(task);
    setFocusSec(FOCUS_MINUTES * 60);
    setFocusRunning(false);
    setFocusDone(false);
  }
  function closeFocus() {
    setFocusTask(null); setFocusRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }
  async function completeFocusTask() {
    if (focusTask) { await toggleStatus(focusTask); }
    closeFocus();
  }

  function openEdit(task: Task, e: React.MouseEvent) {
    e.stopPropagation();
    if (task._virtual) return;
    setEditTask(task);
    setEditForm({ title: task.title, description: task.description, due_date: dateStrFromTs(task.due_date), type: task.type });
  }
  async function saveEdit() {
    if (!editTask || !editForm.title.trim()) return;
    setEditLoading(true);
    const due_date = editForm.due_date ? tsFromDateStr(editForm.due_date) : editTask.due_date;
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILD.UPDATE_TASK(editTask.id)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editForm.title, description: editForm.description, type: editForm.type, due_date }),
      });
      setWeekAllTasks(prev => prev.map(t => t.id === editTask.id ? { ...t, title: editForm.title, description: editForm.description, type: editForm.type, due_date } : t));
      setEditTask(null);
    } catch {} finally { setEditLoading(false); }
  }

  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim(); setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: msg }]);
    setChatLoading(true);
    try {
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, authToken }),
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'bot', text: data.reply || 'נוצרה משימה חדשה! ✅' }]);
      fetchWeekData(true);
    } catch {
      setChatMessages(prev => [...prev, { role: 'bot', text: 'אירעה שגיאה. נסה שוב.' }]);
    } finally { setChatLoading(false); }
  }

  async function moveTaskToDayHour(taskId: number, targetDay: Date, hour: number) {
    const task = weekAllTasks.find(t => t.id === taskId);
    if (!task || task._virtual) return;
    const mins = new Date(task.due_date * 1000).getMinutes();
    const newTs = tsFromDateAndHour(dayStrOf(targetDay), hour) + mins * 60;
    setWeekAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, due_date: newTs } : t));
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILD.UPDATE_TASK(taskId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: newTs }),
      });
    } catch {}
  }

  async function openSchoolModal() {
    setSchoolDebug('');
    setSchoolParseError('');
    // Pre-populate grid from existing schedule slots
    const grid: Record<string, string> = {};
    scheduleSlots.forEach(slot => {
      const dayKey = slot.day_of_week || slot.dayofweek || slot.day || '';
      const dayNum = DAY_OF_WEEK_NUM[dayKey];
      if (dayNum !== undefined && dayNum <= 5) {
        const hour = parseTimeHour(slot.start_time || slot.startTime || '');
        if (SCHOOL_PERIODS.includes(hour)) grid[`${dayNum}-${hour}`] = slot.Subject || slot.subject || '';
      }
    });
    setSchoolGrid(grid);
    setShowSchoolModal(true);
  }

  async function readFileAsPayload(file: File): Promise<{ text?: string; image_base64?: string; image_type?: string; error?: string }> {
    // HEIC is not supported by Claude Vision
    if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
      return { error: 'קבצי HEIC (צילומי iPhone) אינם נתמכים. שלח צילום מסך (PNG/JPG) במקום.' };
    }
    if (file.type.startsWith('image/')) {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      return { image_base64: base64, image_type: file.type };
    }
    // PDF and binary Office formats cannot be read as text — block them
    if (file.type === 'application/pdf' || file.type.includes('officedocument') || file.type.includes('msword')) {
      return { error: 'קובצי PDF ו-Word אינם נתמכים. העלה תמונה (צילום מסך) של מערכת השעות, או הדבק את הטקסט ידנית.' };
    }
    const text = (await file.text()).substring(0, 8000);
    return { text };
  }

  async function saveScheduleSlots(parsedSlots: ScheduleSlot[]) {
    // Persist to Xano in the background — don't rely on Meta API response format
    fetch('/api/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId: child?.id, slots: parsedSlots }),
    }).catch(() => {});

    // Use Claude's parsed slots directly for display — field format is guaranteed correct
    const forDisplay = parsedSlots.map((s, i) => ({ ...s, id: -(2000000 + i) })) as ScheduleSlot[];
    const grid: Record<string, string> = {};
    forDisplay.forEach(slot => {
      const dayNum = DAY_OF_WEEK_NUM[slot.day_of_week || ''];
      if (dayNum !== undefined) {
        const hour = parseTimeHour(slot.start_time || '');
        if (SCHOOL_PERIODS.includes(hour)) grid[`${dayNum}-${hour}`] = slot.Subject || '';
      }
    });
    setScheduleSlots(forDisplay);
    setSchoolGrid(grid);
    setShowSchoolModal(false);
    if (kidDataCache) { kidDataCache.slots = forDisplay; applyWeekView(kidDataCache, weekDays(currentDate)); }
    else fetchWeekData(true);
  }

  function slotsToGrid(slots: Array<{ day_of_week?: string; Subject?: string; start_time?: string }>): Record<string, string> {
    const grid: Record<string, string> = {};
    slots.forEach(slot => {
      const dayNum = DAY_OF_WEEK_NUM[slot.day_of_week || ''];
      if (dayNum !== undefined && dayNum <= 5) {
        const hour = parseTimeHour(slot.start_time || '');
        if (SCHOOL_PERIODS.includes(hour)) grid[`${dayNum}-${hour}`] = slot.Subject || '';
      }
    });
    return grid;
  }

  async function parseSchoolFile(file: File) {
    setSchoolLoading(true);
    setSchoolParseError('');
    try {
      const payload = await readFileAsPayload(file);
      if (payload.error) { setSchoolParseError(payload.error); return; }
      const parseRes = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload }),
      });
      const parseData = await parseRes.json();
      if (!parseRes.ok) {
        const debugInfo = parseData.debug_raw ? ` (AI: "${parseData.debug_raw.substring(0, 80)}...")` : '';
        setSchoolParseError((parseData.error || 'שגיאה בניתוח הקובץ') + debugInfo);
        return;
      }
      // Show parsed result in grid for review — user saves manually
      const parsedSlots = parseData.slots ?? [];
      setSchoolGrid(slotsToGrid(parsedSlots));
      setSchoolParseError('');
      const firstSlot = parseData.debug_first?.[0];
      setSchoolDebug(`AI זיהה ${parseData.debug_count ?? parsedSlots.length} שיעורים. ראשון: ${firstSlot ? `${firstSlot.day_of_week} ${firstSlot.start_time} – ${firstSlot.Subject}` : 'אין'}`);
    } catch { setSchoolParseError('שגיאת רשת'); }
    finally { setSchoolLoading(false); }
  }

  async function parseExamsFile(file: File) {
    setExamsLoading(true);
    setExamsResult('');
    try {
      const payload = await readFileAsPayload(file);
      if (payload.error) { setExamsResult(payload.error); setExamsLoading(false); return; }
      const res = await fetch('/api/exams-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, childId: child?.id, authToken }),
      });
      const data = await res.json();
      if (!res.ok) setExamsResult(data.error || 'שגיאה');
      else { setExamsResult(`✅ נוספו ${data.created} מבחנים!`); if (kidDataCache) kidDataCache = null; fetchWeekData(true); }
    } catch { setExamsResult('שגיאת רשת'); }
    finally { setExamsLoading(false); }
  }

  async function parseExamsText() {
    if (!examsText.trim()) return;
    setExamsLoading(true);
    setExamsResult('');
    try {
      const res = await fetch('/api/exams-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: examsText, childId: child?.id, authToken }),
      });
      const data = await res.json();
      if (!res.ok) setExamsResult(data.error || 'שגיאה');
      else { setExamsResult(`✅ נוספו ${data.created} מבחנים!`); setExamsText(''); if (kidDataCache) kidDataCache = null; fetchWeekData(true); }
    } catch { setExamsResult('שגיאת רשת'); }
    finally { setExamsLoading(false); }
  }

  async function parseSchoolText() {
    if (!schoolText.trim()) return;
    setSchoolLoading(true);
    setSchoolParseError('');
    try {
      const parseRes = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: schoolText }),
      });
      const parseData = await parseRes.json();
      if (!parseRes.ok) { setSchoolParseError(parseData.error || 'שגיאה בניתוח הטקסט'); return; }
      // Show parsed result in grid for review — user saves manually
      setSchoolGrid(slotsToGrid(parseData.slots ?? []));
      setSchoolText('');
    } catch { setSchoolParseError('שגיאת רשת'); }
    finally { setSchoolLoading(false); }
  }

  async function submitSchoolSchedule() {
    const entries = Object.entries(schoolGrid).filter(([, v]) => v.trim());
    setSchoolLoading(true);
    const slots = entries.map(([key, subject]) => {
      const [dayIdxStr, hourStr] = key.split('-');
      const dayIdx = parseInt(dayIdxStr);
      const hour = parseInt(hourStr);
      return {
        day_of_week: DAY_NAMES[dayIdx],
        Subject: subject,
        start_time: `${String(hour).padStart(2, '0')}:00`,
        endtime: `${String(hour + 1).padStart(2, '0')}:00`,
      };
    });
    // Persist to Xano in background
    fetch('/api/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId: child?.id, slots }),
    }).catch(() => {});
    // Use locally-constructed slots for immediate display
    const forDisplay = slots.map((s, i) => ({ ...s, id: -(2000000 + i) })) as ScheduleSlot[];
    setScheduleSlots(forDisplay);
    setSchoolGrid({});
    setShowSchoolModal(false);
    if (kidDataCache) { kidDataCache.slots = forDisplay; applyWeekView(kidDataCache, weekDays(currentDate)); }
    else fetchWeekData(true);
    setSchoolLoading(false);
  }

  // Returns pre-filled datetime-local strings spread before the test
  function suggestStudySessions(test: Task): string[] {
    const d = daysUntil(test.due_date);
    // offsets (days before test) → study hour
    const plan: number[] =
      d >= 7 ? [-6, -4, -2, -1] :
      d >= 4 ? [-3, -2, -1] :
      d >= 2 ? [-2, -1] :
      d >= 1 ? [-1] : [0];
    return plan.map(offset => {
      const dt = new Date(test.due_date * 1000);
      dt.setDate(dt.getDate() + offset);
      dt.setHours(17, 0, 0, 0);
      // Don't suggest dates in the past
      if (dt < new Date()) dt.setTime(Date.now() + 3600 * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:00`;
    });
  }

  function openStudyPlanner(test: Task) {
    setSchedulerTest(test);
    setStudySessions(suggestStudySessions(test));
    setStudyMaterial('');
  }

  async function scheduleStudy() {
    if (!schedulerTest) return;
    setSchedulerLoading(true);
    const valid = studySessions.filter(s => s.trim());
    for (const s of valid) {
      const due_date = Math.floor(new Date(s).getTime() / 1000);
      const title = `📖 לימוד: ${schedulerTest.title}`;
      const description = studyMaterial.trim() ? `חומר: ${studyMaterial.trim()}` : `הכנה למבחן: ${schedulerTest.title}`;
      const tmpId = -(Date.now() + Math.random() * 1000);
      const newTask: Task = { id: tmpId, title, description, due_date, status: 'pending', type: 'homework' };
      setWeekAllTasks(prev => [...prev, newTask]);
      setAllRealTasksState(prev => sortByUrgency([...prev, newTask]));
      try {
        const res = await fetch(`${API_URL}${API_ENDPOINTS.CHILD.CREATE_TASK}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, type: 'homework', due_date, description }),
        });
        if (res.ok) {
          const created = await res.json() as Task & { due_date: number };
          const normalized = { ...created, due_date: created.due_date > 1e10 ? Math.floor(created.due_date / 1000) : created.due_date };
          setWeekAllTasks(prev => prev.map(t => t.id === tmpId ? normalized : t));
          setAllRealTasksState(prev => sortByUrgency(prev.map(t => t.id === tmpId ? normalized : t)));
          if (kidDataCache) kidDataCache.tasks = [...kidDataCache.tasks.filter(t => t.id !== tmpId), normalized];
        }
      } catch {}
    }
    setSchedulerTest(null);
    setStudySessions([]);
    setStudyMaterial('');
    setSchedulerLoading(false);
  }

  async function fetchPracticeExam(subject: string, material: string) {
    setPracticeLoading(true);
    setPracticeError('');
    try {
      const res = await fetch('/api/practice-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, material, grade: child?.grade || '5' }),
      });
      const data = await res.json();
      if (!res.ok) { setPracticeError(data.error || 'שגיאה'); return; }
      setPracticeExam({ subject, questions: data.questions });
      setUserAnswers({});
      setShowAnswers(false);
    } catch { setPracticeError('שגיאת רשת'); }
    finally { setPracticeLoading(false); }
  }

  async function submitAddTask() {
    if (!addTaskCell || !addTaskTitle.trim()) return;
    setAddTaskLoading(true);
    const due_date = tsFromDateAndHour(dayStrOf(addTaskCell.day), addTaskCell.hour);
    const title = addTaskTitle.trim();
    const type = addTaskType;
    const tmpId = -(Date.now());
    const newTask: Task = { id: tmpId, title, description: '', due_date, status: 'pending', type };
    setWeekAllTasks(prev => [...prev, newTask]);
    setAllRealTasksState(prev => sortByUrgency([...prev, newTask]));
    setAddTaskCell(null);
    setAddTaskTitle('');
    setAddTaskType('homework');
    try {
      const res = await fetch(`${API_URL}${API_ENDPOINTS.CHILD.CREATE_TASK}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, type, due_date, description: '' }),
      });
      if (res.ok) {
        const created = await res.json() as Task & { due_date: number };
        const normalized = { ...created, due_date: created.due_date > 1e10 ? Math.floor(created.due_date / 1000) : created.due_date };
        setWeekAllTasks(prev => prev.map(t => t.id === tmpId ? normalized : t));
        setAllRealTasksState(prev => sortByUrgency(prev.map(t => t.id === tmpId ? normalized : t)));
        if (kidDataCache) kidDataCache.tasks = [...kidDataCache.tasks.filter(t => t.id !== tmpId), normalized];
      }
    } catch {} finally { setAddTaskLoading(false); }
  }

  // ─── Derived ───────────────────────────────────────────────────────────────
  const wDays = weekDays(currentDate);
  const today = new Date();

  const rawVisible = view === 'day'
    ? weekAllTasks.filter(t => sameDay(new Date(t.due_date * 1000), currentDate))
    : weekAllTasks;
  const visibleTasks = sortByUrgency(rawVisible);

  // All real tasks (persists across week navigation) — used for task lists & progress
  const allPending = allRealTasksState.filter(t => t.status !== 'done');
  const visibleReal = weekAllTasks.filter(t => {
    if (t._virtual) return false;
    const d = new Date(t.due_date * 1000); d.setHours(0, 0, 0, 0);
    return view === 'day' ? sameDay(d, currentDate) : d >= wDays[0] && d <= wDays[6];
  });
  const allDone    = visibleReal.filter(t => t.status === 'done');

  const doneCnt = visibleTasks.filter(t => t.status === 'done').length;
  const pendingTasks = visibleTasks.filter(t => t.status !== 'done');
  const upcomingTests = allRealTasksState.filter(t => isTest(t) && t.status !== 'done' && daysUntil(t.due_date) >= 0 && daysUntil(t.due_date) <= 14);
  // Tests within 7 days that have no study tasks yet
  const testsNeedingPlan = upcomingTests.filter(t =>
    daysUntil(t.due_date) <= 7 &&
    !allRealTasksState.some(r => r.title.startsWith('📖 לימוד:') && r.title.includes(t.title))
  );
  const heroTask = allPending[0] || null;

  const dateLabel = view === 'day'
    ? `${HEBREW_DAYS[currentDate.getDay()]}, ${currentDate.getDate()} ${HEBREW_MONTHS[currentDate.getMonth()]}`
    : `${wDays[0].getDate()}–${wDays[6].getDate()} ${HEBREW_MONTHS[wDays[6].getMonth()]}`;

  const navDate = (delta: number) => setCurrentDate(prev => {
    const d = new Date(prev); d.setDate(d.getDate() + delta); return d;
  });

  const typeEmoji = (t: Task['type']) => ({ homework: '📚', test: '📝', activity: '🎨', other: '✏️', school: '🏫', holiday: '🎉' }[t] ?? '✏️');
  const statusIcon = (s: Task['status'], big = false) => {
    const size = big ? 30 : 24;
    if (s === 'done') return <CheckCircle2 size={size} color="#6BCB77" />;
    if (s === 'in_progress') return <Clock size={size} color="#74B9FF" />;
    return <Circle size={size} color="#C4BEFF" />;
  };
  const urgencyLabel = { overdue: 'באיחור!', today: 'היום', tomorrow: 'מחר', soon: 'בקרוב', later: '', done: '' };

  // Focus timer display
  const focusProgress = focusSec / (FOCUS_MINUTES * 60);
  const strokeOffset = TIMER_CIRCUMFERENCE * (1 - focusProgress);
  const focusMin = String(Math.floor(focusSec / 60)).padStart(2, '0');
  const focusSc = String(focusSec % 60).padStart(2, '0');

  // Rank
  const rank = points < 50 ? '🌱 מתחיל' : points < 150 ? '⭐ עולה' : points < 300 ? '🚀 מתקדם' : '🏆 אלוף';

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="kid-app">

      {/* ── HEADER ── */}
      <header className="kid-header">
        <div className="kid-avatar">{child?.name?.charAt(0)}</div>
        <div className="kid-header-info">
          <div className="kid-header-name">שלום, {child?.name}! 👋</div>
          <div className="kid-rank">{rank}</div>
        </div>
        <div className="kid-header-stats">
          {streak > 0 && <div className="streak-badge">🔥 {streak}</div>}
          <div className="points-badge">⭐ {points}</div>
        </div>
        <button className="kid-logout-btn" onClick={() => { logout(); router.push('/child-app'); }}>
          <LogOut size={18} />
        </button>
      </header>

      <main className="kid-main">

        {/* ── TEST BANNERS ── */}
        {upcomingTests.length > 0 && (
          <div className="test-banners">
            {upcomingTests.map(test => {
              const d = daysUntil(test.due_date);
              const needsPlan = testsNeedingPlan.some(t => t.id === test.id);
              return (
                <div key={test.id} className={`test-banner${d <= 1 ? ' urgent' : ''}${needsPlan ? ' needs-plan' : ''}`}>
                  <span className="test-banner-icon">📝</span>
                  <div className="test-banner-text">
                    <strong>{test.title}</strong>
                    <span>{d === 0 ? 'היום!' : d === 1 ? 'מחר!' : `בעוד ${d} ימים`}</span>
                    {needsPlan && <span className="needs-plan-label">⚠️ טרם תוכנן זמן לימוד!</span>}
                  </div>
                  <button className="test-banner-btn" onClick={() => openStudyPlanner(test)}>
                    {needsPlan ? '📅 תכנן עכשיו!' : 'תכנן לימוד'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── HERO: NEXT TASK ── */}
        {heroTask && (
          <div className={`kid-hero hero-${urgencyKey(heroTask.due_date, heroTask.status)}`}>
            <div className="hero-label">
              <Target size={14} />
              המשימה הבאה שלי
            </div>
            <div className="hero-title">
              <span>{typeEmoji(heroTask.type)}</span>
              {heroTask.title}
            </div>
            {heroTask.description && <div className="hero-desc">{heroTask.description}</div>}
            <div className="hero-time">{relativeDate(heroTask.due_date)}</div>
            <div className="hero-actions">
              <button className="hero-focus-btn" onClick={() => openFocus(heroTask)}>
                <Play size={16} />
                התחל עכשיו ⏱
              </button>
              <button className="hero-done-btn" onClick={() => toggleStatus(heroTask)}>
                {statusIcon(heroTask.status)}
              </button>
            </div>
          </div>
        )}

        {/* ── PROGRESS BAR ── */}
        {visibleReal.length > 0 && (
          <div className="kid-progress-wrap">
            <div className="kid-progress-label">
              <span>{allDone.length} / {visibleReal.length} הושלמו</span>
              <span>{Math.round((allDone.length / visibleReal.length) * 100)}%</span>
            </div>
            <div className="kid-progress-bar">
              <div className="kid-progress-fill" style={{ width: `${(allDone.length / visibleReal.length) * 100}%` }} />
            </div>
          </div>
        )}

        {/* ── PENDING TASKS LIST ── */}
        {allPending.length > 0 && (
          <div className="pending-tasks-list">
            {allPending.map(task => {
              const uk = urgencyKey(task.due_date, task.status);
              return (
                <div key={task.id} className={`pending-task-row urgency-row-${uk}`}>
                  <button className="pending-task-check" onClick={() => toggleStatus(task)} title="סמן כהושלם">
                    {task.status === 'in_progress' ? <Clock size={22} color="#74B9FF" /> : <Circle size={22} color="#C4BEFF" />}
                  </button>
                  <span className="pending-task-emoji">{typeEmoji(task.type)}</span>
                  <div className="pending-task-info">
                    <span className="pending-task-title">{task.title}</span>
                    <span className="pending-task-date">{relativeDate(task.due_date)}</span>
                  </div>
                  {task.status === 'in_progress' && (
                    <button className="pending-task-done-btn" onClick={() => toggleStatus(task)}>✓ סיימתי</button>
                  )}
                  {task.status === 'pending' && (
                    <button className="pending-task-start-btn" onClick={() => toggleStatus(task)}>▶ התחל</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── COMPLETED TASKS LIST ── */}
        {allDone.length > 0 && (
          <div className="done-tasks-section">
            <button className="done-tasks-toggle" onClick={() => setShowDone(p => !p)}>
              <CheckCircle2 size={16} color="#6BCB77" />
              <span>{allDone.length} משימות שהושלמו</span>
              <span className="done-toggle-arrow">{showDone ? '▲' : '▼'}</span>
            </button>
            {showDone && (
              <div className="done-tasks-list">
                {allDone.map(task => (
                  <div key={task.id} className="done-task-row">
                    <span className="done-task-emoji">{typeEmoji(task.type)}</span>
                    <span className="done-task-title">{task.title}</span>
                    <button className="done-task-undo" onClick={() => toggleStatus(task)} title="בטל סימון">↩</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ALWAYS-VISIBLE WEEK PREVIEW ── */}
        <div className="week-preview-wrap">
          <div className="week-preview-header">
            <button className="wpv-arrow" onClick={() => navDate(-7)}><ChevronRight size={16} /></button>
            <span className="wpv-label">תצוגת שבוע</span>
            <button className="wpv-arrow" onClick={() => navDate(7)}><ChevronLeft size={16} /></button>
          </div>
          <div className="week-preview">
            {wDays.map((day, i) => {
              const dayTasks = weekAllTasks.filter(t => sameDay(new Date(t.due_date * 1000), day));
              const pending = sortByUrgency(dayTasks.filter(t => t.status !== 'done'));
              const doneCount = dayTasks.filter(t => t.status === 'done').length;
              const hasTest = dayTasks.some(t => isTest(t) && t.status !== 'done');
              const isSelected = sameDay(day, currentDate);
              const isToday = sameDay(day, today);
              const dotColors: Record<string, string> = {
                overdue: '#FF6B6B', today: '#FF9F43', tomorrow: '#FFD93D',
                soon: '#A8E063', later: '#C4BEFF', done: '#6BCB77',
              };
              return (
                <div
                  key={i}
                  className={`wpd${isSelected ? ' wpd-selected' : ''}${isToday ? ' wpd-today' : ''}`}
                  onClick={() => { setCurrentDate(day); setView('day'); }}
                >
                  <div className="wpd-name">{HEBREW_DAYS[day.getDay()]}</div>
                  <div className="wpd-num">{day.getDate()}</div>
                  <div className="wpd-dots">
                    {pending.slice(0, 3).map((t, di) => (
                      <span key={di} className="wpd-dot" style={{ background: dotColors[urgencyKey(t.due_date, t.status)] }} />
                    ))}
                    {pending.length > 3 && <span className="wpd-more">+</span>}
                  </div>
                  {hasTest && <div className="wpd-test">📝</div>}
                  {doneCount > 0 && pending.length === 0 && <div className="wpd-done-all">✓</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── CALENDAR CONTROLS ── */}
        <div className="kid-cal-controls">
          <div className="kid-view-toggle">
            <button className={`kid-view-btn${view === 'day' ? ' active' : ''}`} onClick={() => setView('day')}>יום</button>
            <button className={`kid-view-btn${view === 'week' ? ' active' : ''}`} onClick={() => setView('week')}>שבוע</button>
          </div>
          <div className="kid-cal-nav">
            <button className="nav-arrow" onClick={() => navDate(view === 'week' ? -7 : -1)}><ChevronRight size={18} /></button>
            <span className="kid-date-label">{dateLabel}</span>
            <button className="nav-arrow" onClick={() => navDate(view === 'week' ? 7 : 1)}><ChevronLeft size={18} /></button>
          </div>
          <button className="kid-today-btn" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setCurrentDate(d); }}>היום</button>
        </div>

        {/* ── SMART CALENDAR (unified time-grid for both day & week) ── */}
        <div className="kid-tasks-section">
          {tasksLoading ? (
            <div className="tasks-loading"><div className="spinner" /></div>
          ) : (
            <div className="smart-cal-outer">
              {/* Column headers */}
              <div className="smart-cal-head">
                <div className="sc-corner" />
                {(view === 'day' ? [currentDate] : wDays).map((day, i) => {
                  const isToday = sameDay(day, today);
                  const dayDone = weekAllTasks.filter(t => sameDay(new Date(t.due_date * 1000), day) && t.status === 'done').length;
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
                {/* "Now" line */}
                {(() => {
                  const now = new Date();
                  const nowIdx = GRID_HOURS.indexOf(now.getHours());
                  const showNow = view === 'day'
                    ? sameDay(currentDate, today)
                    : wDays.some(d => sameDay(d, today));
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
                        {sortByUrgency(out).map(task => {
                          const uk = urgencyKey(task.due_date, task.status);
                          return (
                            <div key={task.id}
                              className={`sc-event ev-${task.type} urgency-${uk}${task.status === 'done' ? ' ev-done' : ''}${(task as {_virtual?: boolean})._virtual ? ' ev-readonly' : ''}`}
                              onClick={(task as {_virtual?: boolean})._virtual ? undefined : () => toggleStatus(task)}>
                              <span className="ev-emoji">{typeEmoji(task.type)}</span>
                              <span className={`ev-title${task.status === 'done' ? ' done' : ''}`}>{task.title}</span>
                              {!(task as {_virtual?: boolean})._virtual && <button className="ev-edit" onClick={e => openEdit(task, e)}><Edit3 size={10} /></button>}
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
                        const cellTasks = sortByUrgency(
                          weekAllTasks.filter(t => sameDay(new Date(t.due_date * 1000), day) && getTaskHour(t.due_date) === hour)
                        );
                        const isDragOver = dragOverCell?.di === di && dragOverCell?.hour === hour;
                        return (
                          <div key={di}
                            className={`sc-cell${isToday ? ' sc-today-col' : ''}${isDragOver ? ' sc-drag-over' : ''}`}
                            onDragOver={e => { e.preventDefault(); setDragOverCell({ di, hour }); }}
                            onDragLeave={() => setDragOverCell(null)}
                            onDrop={e => {
                              e.preventDefault(); setDragOverCell(null);
                              if (dragTaskId.current !== null) moveTaskToDayHour(dragTaskId.current, day, hour);
                            }}
                            onClick={() => { setAddTaskCell({ day, hour }); setAddTaskTitle(''); setAddTaskType('homework'); }}>
                            {cellTasks.map(task => {
                              const uk = urgencyKey(task.due_date, task.status);
                              return (
                                <div key={task.id}
                                  draggable={!(task as {_virtual?: boolean})._virtual}
                                  onDragStart={(task as {_virtual?: boolean})._virtual ? undefined : e => { e.dataTransfer.setData('text/plain', String(task.id)); dragTaskId.current = task.id; }}
                                  onDragEnd={(task as {_virtual?: boolean})._virtual ? undefined : () => { dragTaskId.current = null; setDragOverCell(null); }}
                                  className={`sc-event ev-${task.type} urgency-${uk}${task.status === 'done' ? ' ev-done' : ''}${isTest(task) && task.status !== 'done' ? ' ev-test' : ''}${(task as {_virtual?: boolean})._virtual ? ' ev-readonly' : ''}`}
                                  onClick={(task as {_virtual?: boolean})._virtual ? e => e.stopPropagation() : e => { e.stopPropagation(); toggleStatus(task); }}>
                                  <span className="ev-emoji">{typeEmoji(task.type)}</span>
                                  <span className={`ev-title${task.status === 'done' ? ' done' : ''}`}>{task.title}</span>
                                  {!(task as {_virtual?: boolean})._virtual && <button className="ev-edit" onClick={e => openEdit(task, e)}><Edit3 size={10} /></button>}
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
                    <div className="kid-empty-emoji">🎉</div>
                    <div className="kid-empty-title">אין משימות!</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── FAB BAR ── */}
      <div className="kid-fab-bar">
        <button className="kid-fab kid-fab-school" onClick={openSchoolModal}>
          <BookOpen size={22} /><span>מערכת</span>
        </button>
        <button className="kid-fab kid-fab-exams" onClick={() => { setExamsResult(''); setShowExamsModal(true); }}>
          <FileText size={22} /><span>מבחנים</span>
        </button>
        <button className="kid-fab kid-fab-chat" onClick={() => setShowChat(true)}>
          <Bot size={22} /><span>צ&apos;אט</span>
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════
          OVERLAYS & MODALS
      ══════════════════════════════════════════════════════════ */}

      {/* ── CELEBRATION ── */}
      {celebration && (
        <div className="celebration-overlay" onClick={() => setCelebration(null)}>
          <div className="celebration-card">
            <div className="celebration-big-emoji">🎉</div>
            <div className="celebration-title">כל הכבוד!</div>
            <div className="celebration-task-name">{celebration.title}</div>
            <div className="celebration-msg">{celebMsg}</div>
            <div className="celebration-points">+10 ⭐</div>
            <div className="celebration-stars">✨ ✨ ✨</div>
          </div>
        </div>
      )}

      {/* ── FOCUS TIMER ── */}
      {focusTask && (
        <div className="focus-overlay">
          <div className="focus-card">
            <button className="focus-close" onClick={closeFocus}><X size={20} /></button>
            <div className="focus-task-emoji">{typeEmoji(focusTask.type)}</div>
            <div className="focus-task-title">{focusTask.title}</div>
            <div className="focus-mode-label">מצב ריכוז — {FOCUS_MINUTES} דקות</div>

            {/* Circular SVG timer */}
            <div className="focus-timer-wrap">
              <svg viewBox="0 0 120 120" width="200" height="200">
                <circle cx="60" cy="60" r="54" fill="none" stroke="#E8E6FF" strokeWidth="8" />
                <circle
                  cx="60" cy="60" r="54"
                  fill="none"
                  stroke={focusDone ? '#6BCB77' : focusSec < 120 ? '#FF6B6B' : '#6C63FF'}
                  strokeWidth="8"
                  strokeDasharray={TIMER_CIRCUMFERENCE}
                  strokeDashoffset={strokeOffset}
                  strokeLinecap="round"
                  transform="rotate(-90 60 60)"
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
                <text x="60" y="56" textAnchor="middle" fontSize="26" fontWeight="800" fill="#2C2C54" fontFamily="Fredoka One, cursive">
                  {focusMin}:{focusSc}
                </text>
                <text x="60" y="74" textAnchor="middle" fontSize="11" fill="#8888AA" fontWeight="600">
                  {focusDone ? 'סיימת! 🎉' : 'דקות נותרו'}
                </text>
              </svg>
            </div>

            {focusDone ? (
              <div className="focus-done-msg">
                <div>⏰ הזמן הסתיים! האם סיימת?</div>
              </div>
            ) : (
              <button className="focus-play-btn" onClick={() => setFocusRunning(r => !r)}>
                {focusRunning ? <><Pause size={20} /> עצור</> : <><Play size={20} /> {focusSec === FOCUS_MINUTES * 60 ? 'התחל' : 'המשך'}</>}
              </button>
            )}

            <div className="focus-action-row">
              <button className="focus-done-btn" onClick={completeFocusTask}>
                <CheckCircle2 size={18} />
                סיימתי את המשימה! ✅
              </button>
              <button className="focus-exit-btn" onClick={closeFocus}>
                יציאה בלי לסיים
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT TASK ── */}
      {editTask && (
        <div className="modal-overlay" onClick={() => setEditTask(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditTask(null)}><X size={20} /></button>
            <div className="modal-header">
              <div className="modal-icon" style={{ background: 'linear-gradient(135deg, #6C63FF, #74B9FF)' }}>
                <Edit3 size={28} color="white" />
              </div>
              <h2 className="modal-title">עריכת משימה</h2>
            </div>
            <div className="form-field">
              <label>כותרת</label>
              <input type="text" className="form-select" value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="form-field" style={{ marginTop: 12 }}>
              <label>תיאור</label>
              <textarea className="form-textarea" value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} rows={3} />
            </div>
            <div className="form-field" style={{ marginTop: 12 }}>
              <label>סוג</label>
              <select className="form-select" value={editForm.type} onChange={e => setEditForm(p => ({ ...p, type: e.target.value as Task['type'] }))}>
                <option value="homework">שיעורי בית 📚</option>
                <option value="test">מבחן 📝</option>
                <option value="activity">פעילות 🎨</option>
                <option value="school">שיעור בבית ספר 🏫</option>
                <option value="other">אחר ✏️</option>
              </select>
            </div>
            <div className="form-field" style={{ marginTop: 12 }}>
              <label>תאריך</label>
              <input type="date" className="form-select" value={editForm.due_date} onChange={e => setEditForm(p => ({ ...p, due_date: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button className="btn-primary" onClick={saveEdit} disabled={editLoading || !editForm.title.trim()} style={{ flex: 1 }}>
                {editLoading ? 'שומר...' : 'שמור'}
              </button>
              <button className="btn-secondary" onClick={() => setEditTask(null)} style={{ flex: 1 }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ── QUICK ADD TASK (calendar cell click) ── */}
      {addTaskCell && (
        <div className="modal-overlay" onClick={() => setAddTaskCell(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 340 }}>
            <button className="modal-close" onClick={() => setAddTaskCell(null)}><X size={20} /></button>
            <div className="modal-header">
              <div className="modal-icon" style={{ background: 'linear-gradient(135deg, #6BCB77, #74B9FF)' }}>
                <Zap size={28} color="white" />
              </div>
              <h2 className="modal-title">הוסף משימה</h2>
              <p className="modal-sub">
                {HEBREW_DAYS[addTaskCell.day.getDay()]}, {addTaskCell.day.getDate()} {HEBREW_MONTHS[addTaskCell.day.getMonth()]} — {String(addTaskCell.hour).padStart(2, '0')}:00
              </p>
            </div>
            <div className="form-field">
              <label>כותרת</label>
              <input
                type="text"
                className="form-select"
                placeholder="מה צריך לעשות?"
                value={addTaskTitle}
                autoFocus
                onChange={e => setAddTaskTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitAddTask(); }}
              />
            </div>
            <div className="form-field" style={{ marginTop: 12 }}>
              <label>סוג</label>
              <select className="form-select" value={addTaskType} onChange={e => setAddTaskType(e.target.value as Task['type'])}>
                <option value="homework">שיעורי בית 📚</option>
                <option value="test">מבחן 📝</option>
                <option value="activity">פעילות 🎨</option>
                <option value="other">אחר ✏️</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button className="btn-primary" onClick={submitAddTask} disabled={addTaskLoading || !addTaskTitle.trim()} style={{ flex: 1 }}>
                {addTaskLoading ? 'שומר...' : '+ הוסף'}
              </button>
              <button className="btn-secondary" onClick={() => setAddTaskCell(null)} style={{ flex: 1 }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ── STUDY SCHEDULER ── */}
      {schedulerTest && (
        <div className="modal-overlay" onClick={() => { setSchedulerTest(null); setStudySessions([]); setStudyMaterial(''); }}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { setSchedulerTest(null); setStudySessions([]); setStudyMaterial(''); }}><X size={20} /></button>
            <div className="modal-header">
              <div className="modal-icon" style={{ background: 'linear-gradient(135deg, #FFD93D, #FF6B6B)' }}>
                <BookOpen size={28} color="white" />
              </div>
              <h2 className="modal-title">תכנון לימוד למבחן</h2>
              <p className="modal-sub">📝 <strong>{schedulerTest.title}</strong></p>
              <p className="modal-sub" style={{ color: '#FF6B6B', fontWeight: 800 }}>
                {daysUntil(schedulerTest.due_date) === 0 ? 'המבחן היום!' :
                 daysUntil(schedulerTest.due_date) === 1 ? 'המבחן מחר!' :
                 `${daysUntil(schedulerTest.due_date)} ימים עד המבחן`}
              </p>
            </div>

            {/* Learning material */}
            <div className="form-field" style={{ marginBottom: 16 }}>
              <label>📚 מה צריך ללמוד? (חומר הלימוד)</label>
              <textarea
                className="form-textarea"
                placeholder="לדוגמה: פרקים 3-5, נוסחאות מהיחידה..."
                value={studyMaterial}
                onChange={e => setStudyMaterial(e.target.value)}
                rows={2}
              />
            </div>

            {/* Recommended sessions */}
            <div className="study-sessions-label">
              ⏰ מפגשי לימוד מומלצים — ניתן לשנות את השעות:
            </div>
            {studySessions.map((s, i) => (
              <div key={i} className="study-session-row">
                <span className="study-session-num">{i + 1}</span>
                <input type="datetime-local" className="form-select study-session-input" value={s}
                  onChange={e => setStudySessions(p => p.map((x, j) => j === i ? e.target.value : x))} />
                <button className="study-session-del" onClick={() => setStudySessions(p => p.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button className="btn-secondary" style={{ marginBottom: 18, width: '100%' }}
              onClick={() => {
                const last = studySessions[studySessions.length - 1];
                const base = last ? new Date(last) : new Date();
                base.setDate(base.getDate() - 1);
                base.setHours(17, 0, 0, 0);
                const pad = (n: number) => String(n).padStart(2, '0');
                setStudySessions(p => [...p, `${base.getFullYear()}-${pad(base.getMonth()+1)}-${pad(base.getDate())}T17:00`]);
              }}>
              + הוסף מפגש לימוד
            </button>

            <button className="btn-primary" style={{ width: '100%', marginBottom: 10 }} onClick={scheduleStudy}
              disabled={schedulerLoading || !studySessions.some(s => s.trim())}>
              <Zap size={18} style={{ marginLeft: 8 }} />
              {schedulerLoading ? 'יוצר משימות...' : `✅ צור ${studySessions.filter(s=>s.trim()).length} משימות לימוד`}
            </button>
            <button className="btn-practice" style={{ width: '100%' }}
              disabled={practiceLoading || (!studyMaterial.trim() && !schedulerTest?.title)}
              onClick={() => fetchPracticeExam(schedulerTest?.title || '', studyMaterial)}>
              {practiceLoading ? '⏳ יוצר מבחן תרגול...' : '🧠 קבל מבחן תרגול מה-AI'}
            </button>
            {practiceError && <p style={{ color: '#FF6B6B', fontSize: '0.85rem', marginTop: 8, textAlign: 'center' }}>{practiceError}</p>}
          </div>
        </div>
      )}

      {/* ── PRACTICE EXAM ── */}
      {practiceExam && (
        <div className="modal-overlay" onClick={() => setPracticeExam(null)}>
          <div className="modal-card modal-wide" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            <button className="modal-close" onClick={() => setPracticeExam(null)}><X size={20} /></button>
            <div className="modal-header">
              <div className="modal-icon" style={{ background: 'linear-gradient(135deg, #6C63FF, #A29BFE)' }}>
                <BookOpen size={28} color="white" />
              </div>
              <h2 className="modal-title">מבחן תרגול 🧠</h2>
              <p className="modal-sub">{practiceExam.subject} — כיתה {child?.grade}</p>
            </div>

            {practiceExam.questions.map((q, i) => {
              const answered = userAnswers[i] !== undefined;
              const correct = showAnswers && userAnswers[i]?.trim() === q.answer?.trim();
              const wrong   = showAnswers && answered && !correct;
              return (
                <div key={i} className={`practice-q${showAnswers ? (correct ? ' q-correct' : answered ? ' q-wrong' : '') : ''}`}>
                  <div className="practice-q-num">שאלה {i + 1}</div>
                  <div className="practice-q-text">{q.question}</div>
                  {q.type === 'multiple_choice' && q.options && (
                    <div className="practice-options">
                      {q.options.map((opt, oi) => (
                        <label key={oi} className={`practice-option${userAnswers[i] === opt[0] ? ' selected' : ''}${showAnswers && q.answer === opt[0] ? ' correct-opt' : ''}${showAnswers && userAnswers[i] === opt[0] && q.answer !== opt[0] ? ' wrong-opt' : ''}`}>
                          <input type="radio" name={`q${i}`} value={opt[0]} disabled={showAnswers}
                            checked={userAnswers[i] === opt[0]}
                            onChange={() => setUserAnswers(p => ({ ...p, [i]: opt[0] }))} />
                          {opt}
                        </label>
                      ))}
                    </div>
                  )}
                  {(q.type === 'short_answer' || q.type === 'fill_blank') && (
                    <input type="text" className="form-select practice-input" disabled={showAnswers}
                      placeholder={q.type === 'fill_blank' ? 'השלם את החסר...' : 'כתוב תשובה...'}
                      value={userAnswers[i] ?? ''}
                      onChange={e => setUserAnswers(p => ({ ...p, [i]: e.target.value }))} />
                  )}
                  {showAnswers && (
                    <div className={`practice-answer ${correct ? 'ans-correct' : wrong ? 'ans-wrong' : 'ans-reveal'}`}>
                      {correct ? '✅ נכון!' : wrong ? `❌ לא נכון — התשובה הנכונה: ${q.answer}` : `💡 תשובה: ${q.answer}`}
                    </div>
                  )}
                </div>
              );
            })}

            {!showAnswers ? (
              <button className="btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowAnswers(true)}>
                📊 בדוק תשובות
              </button>
            ) : (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <div className="practice-score">
                  ציון: {practiceExam.questions.filter((q, i) => userAnswers[i]?.trim() === q.answer?.trim()).length} / {practiceExam.questions.length}
                  {' '}{'⭐'.repeat(Math.round(practiceExam.questions.filter((q, i) => userAnswers[i]?.trim() === q.answer?.trim()).length / practiceExam.questions.length * 5))}
                </div>
                <button className="btn-secondary" style={{ marginTop: 10 }}
                  onClick={() => fetchPracticeExam(practiceExam.subject, studyMaterial)}>
                  🔄 מבחן חדש
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SCHOOL SCHEDULE ── */}
      {showSchoolModal && (
        <div className="modal-overlay" onClick={() => setShowSchoolModal(false)}>
          <div className="modal-card modal-wide" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowSchoolModal(false)}><X size={20} /></button>
            <div className="modal-header">
              <div className="modal-icon" style={{ background: 'linear-gradient(135deg, #6C63FF, #A29BFE)' }}>
                <BookOpen size={28} color="white" />
              </div>
              <h2 className="modal-title">טעינת מערכת שעות</h2>
              <p className="modal-sub">הכנס את השיעורים שלך לשבוע הנוכחי — הם יסתמנו אוטומטית כשיסתיימו</p>
            </div>
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: '#6C63FF', fontWeight: 600, marginBottom: 6 }}>העלה קובץ או תמונה:</p>
              <input ref={schoolFileRef} type="file" accept=".txt,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) { parseSchoolFile(f); if (schoolFileRef.current) schoolFileRef.current.value = ''; } }} />
              <button className="btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onClick={() => schoolFileRef.current?.click()} disabled={schoolLoading}>
                <Upload size={16} />{schoolLoading ? 'מנתח...' : 'העלה מערכת שעות מקובץ / תמונה'}
              </button>
              {schoolDebug && <p style={{ color: '#64748b', fontSize: 11, marginTop: 6 }}>{schoolDebug}</p>}
              <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, margin: '10px 0' }}>— או הדבק טקסט —</p>
              <textarea
                rows={4}
                style={{ width: '100%', borderRadius: 10, border: '1.5px solid #e2e8f0', padding: '8px 12px', fontSize: 13, resize: 'vertical', direction: 'rtl', fontFamily: 'Nunito, sans-serif' }}
                placeholder={'ראשון: מתמטיקה 08:00-09:00, עברית 09:00-10:00\nשני: אנגלית 08:00-09:00...\nאו כל פורמט אחר'}
                value={schoolText}
                onChange={e => { setSchoolText(e.target.value); setSchoolParseError(''); }}
              />
              {schoolParseError && <p style={{ color: '#e74c3c', fontSize: 12, marginTop: 4 }}>{schoolParseError}</p>}
              {schoolDebug && <p style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{schoolDebug}</p>}
              <button className="btn-primary" style={{ marginTop: 8, width: '100%' }}
                onClick={parseSchoolText}
                disabled={schoolLoading || !schoolText.trim()}>
                {schoolLoading ? 'מנתח...' : 'נתח טקסט ✨'}
              </button>
            </div>
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, marginBottom: 12 }}>— או מלא ידנית —</p>
            <div className="school-grid-wrap">
              <table className="school-grid">
                <thead>
                  <tr>
                    <th className="sg-th sg-time-col"></th>
                    {SCHOOL_DAYS_HE.map((d, i) => <th key={i} className="sg-th">{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {SCHOOL_PERIODS.map(hour => (
                    <tr key={hour}>
                      <td className="sg-td sg-time-col">{String(hour).padStart(2, '0')}:00</td>
                      {[0, 1, 2, 3, 4, 5].map(dayIdx => {
                        const key = `${dayIdx}-${hour}`;
                        return (
                          <td key={dayIdx} className="sg-td">
                            <input
                              type="text"
                              className="sg-input"
                              placeholder="—"
                              value={schoolGrid[key] || ''}
                              onChange={e => setSchoolGrid(prev => ({ ...prev, [key]: e.target.value }))}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn-primary" style={{ marginTop: 20 }} onClick={submitSchoolSchedule}
              disabled={schoolLoading || !Object.values(schoolGrid).some(v => v.trim())}>
              {schoolLoading ? 'יוצר שיעורים...' : 'טען מערכת שעות ✅'}
            </button>
          </div>
        </div>
      )}

      {/* ── EXAMS MODAL ── */}
      {showExamsModal && (
        <div className="modal-overlay" onClick={() => { setShowExamsModal(false); setExamsResult(''); }}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { setShowExamsModal(false); setExamsResult(''); }}><X size={20} /></button>
            <div className="modal-header">
              <div className="modal-icon" style={{ background: 'linear-gradient(135deg, #FF6B6B, #FFD93D)' }}>
                <FileText size={28} color="white" />
              </div>
              <h2 className="modal-title">טעינת מבחנים</h2>
              <p className="modal-sub">העלה לוח מבחנים מקובץ או הדבק כטקסט</p>
            </div>
            {examsResult ? (
              <div className={examsResult.startsWith('✅') ? 'success-box' : 'error-box'}>{examsResult}</div>
            ) : (
              <>
                <input ref={examsFileRef} type="file" accept=".txt,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) { parseExamsFile(f); if (examsFileRef.current) examsFileRef.current.value = ''; } }} />
                <button className="btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}
                  onClick={() => examsFileRef.current?.click()} disabled={examsLoading}>
                  <Upload size={16} />{examsLoading ? 'מנתח...' : 'העלה לוח מבחנים מקובץ / תמונה'}
                </button>
                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, margin: '4px 0 10px' }}>— או הדבק טקסט —</p>
                <textarea
                  rows={5}
                  style={{ width: '100%', borderRadius: 10, border: '1.5px solid #e2e8f0', padding: '8px 12px', fontSize: 13, resize: 'vertical', direction: 'rtl', fontFamily: 'Nunito, sans-serif' }}
                  placeholder={'מתמטיקה - 15/05/2026\nאנגלית - 20/05/2026 שעה 09:00\n...'}
                  value={examsText}
                  onChange={e => setExamsText(e.target.value)}
                />
                <button className="btn-primary" style={{ marginTop: 8, width: '100%' }}
                  onClick={parseExamsText} disabled={examsLoading || !examsText.trim()}>
                  {examsLoading ? 'מנתח...' : 'נתח ושמור מבחנים ✨'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── CHAT ── */}
      {showChat && (
        <div className="modal-overlay" onClick={() => setShowChat(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowChat(false)}><X size={20} /></button>
            <div className="modal-header">
              <div className="modal-icon modal-icon-bot"><Bot size={28} color="white" /></div>
              <h2 className="modal-title">הוסף משימה בצ&apos;אט</h2>
              <p className="modal-sub">ספר לי מה צריך לעשות ואני אוסיף!</p>
            </div>
            <div className="chat-window">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-bubble chat-bubble-${msg.role}`}>{msg.text}</div>
              ))}
              {chatLoading && (
                <div className="chat-bubble chat-bubble-bot">
                  <span className="typing-dots"><span>.</span><span>.</span><span>.</span></span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-input-row">
              <input type="text" className="chat-input"
                placeholder="לדוגמה: מבחן במתמטיקה ביום שלישי..."
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()} />
              <button className="chat-send" onClick={sendChat} disabled={chatLoading}><Send size={18} /></button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
