'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useChildAuth } from '@/contexts/ChildAuthContext';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2, Circle, Clock, X, Send,
  Bot, ChevronLeft, ChevronRight,
  Edit3, LogOut, BookOpen, Zap, Play, Pause, Target,
} from 'lucide-react';
import { API_URL, API_ENDPOINTS } from '@/lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const normalizeTasks = (arr: Task[]): Task[] => arr.map(t => {
  let due = t.due_date;
  if (!due && t.due_time) due = Math.floor(new Date(t.due_time + 'T12:00:00').getTime() / 1000);
  // Xano returns timestamps in milliseconds; convert to seconds for all calendar math
  if (due && due > 1e10) due = Math.floor(due / 1000);
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
function parseTimeHour(t: string): number { return parseInt((t || '12').split(':')[0]) || 12; }
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
const SCHOOL_PERIODS = [8, 9, 10, 11, 12, 13, 14];
const SCHOOL_DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי'];

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
  const d = daysUntil(ts);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d <= 3) return 'soon';
  return 'later';
}
function relativeDate(ts: number): string {
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
  // Schedule slots (recurring weekly) — stored separately for modal pre-population
  const [scheduleSlots, setScheduleSlots] = useState<ScheduleSlot[]>([]);

  // Cache tracking
  const cacheRef = useRef<{ weekKey: string; fetchedAt: number } | null>(null);
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
  const [studySessions, setStudySessions] = useState(['']);
  const [schedulerLoading, setSchedulerLoading] = useState(false);

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

  // Drag & drop
  const [dragOverCell, setDragOverCell] = useState<{ di: number; hour: number } | null>(null);
  const dragTaskId = useRef<number | null>(null);

  // Calendar body ref for scrolling to current hour
  const calBodyRef = useRef<HTMLDivElement>(null);
  const ROW_HEIGHT = 56;

  // ─── Data fetching — tasks + exams + schedule slots ───────────────────────
  const fetchWeekData = useCallback(async (force = false) => {
    const days = weekDays(currentDate);
    const key = dayStrOf(days[0]);
    const now = Date.now();
    if (!force && cacheRef.current?.weekKey === key && now - cacheRef.current.fetchedAt < CACHE_TTL) return;
    setTasksLoading(true);
    const auth = { Authorization: `Bearer ${authToken}` };
    try {
      const [tasksRes, examsRes, slotsRes, holidaysRes] = await Promise.all([
        fetch(`${API_URL}${API_ENDPOINTS.CHILD.MY_TASKS}?start=${dayStrOf(days[0])}&end=${dayStrOf(days[6])}`, { headers: auth }),
        fetch(`${API_URL}${API_ENDPOINTS.CHILD.EXAMS}?start=${dayStrOf(days[0])}&end=${dayStrOf(days[6])}`, { headers: auth }).catch(() => null),
        fetch(`${API_URL}${API_ENDPOINTS.CHILD.SCHEDULE}`, { headers: auth }).catch(() => null),
        fetch(`${API_URL}${API_ENDPOINTS.CHILD.HOLIDAYS}`, { headers: auth }).catch(() => null),
      ]);
      const realTasks: Task[] = tasksRes.ok ? extractArray(await tasksRes.json()) : [];
      const examTasks: Task[] = examsRes?.ok
        ? (toAnyArray(await examsRes.json()) as Exam[]).flatMap(e => { const t = examToTask(e, days); return t ? [t] : []; })
        : [];
      const slotsRaw = slotsRes?.ok ? await slotsRes.json() : [];
      console.log('[fetchWeekData] raw schedule response:', slotsRaw);
      const slots: ScheduleSlot[] = toAnyArray(slotsRaw) as ScheduleSlot[];
      setScheduleSlots(slots);
      const slotTasks: Task[] = slots.flatMap(s => { const t = slotToTask(s, days); return t ? [t] : []; });
      const holidayTasks: Task[] = holidaysRes?.ok
        ? (toAnyArray(await holidaysRes.json()) as Holiday[]).flatMap(h => holidayToTasks(h, days))
        : [];
      setWeekAllTasks([...realTasks, ...examTasks, ...slotTasks, ...holidayTasks]);
      cacheRef.current = { weekKey: key, fetchedAt: now };
    } catch {} finally { setTasksLoading(false); }
  }, [currentDate, authToken]);

  useEffect(() => { fetchWeekData(); }, [fetchWeekData]);
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
    if (next === 'done') {
      setCelebration(task);
      const newPoints = earnPoints(10);
      const newStreak = updateStreak();
      setPoints(newPoints);
      setStreak(newStreak);
    }
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILD.UPDATE_TASK(task.id)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
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
    // Pre-populate grid from existing schedule slots
    const grid: Record<string, string> = {};
    scheduleSlots.forEach(slot => {
      const dayKey = slot.day_of_week || slot.dayofweek || slot.day || '';
      const dayNum = DAY_OF_WEEK_NUM[dayKey];
      if (dayNum !== undefined && dayNum <= 4) {
        const hour = parseTimeHour(slot.start_time || slot.startTime || '');
        if (SCHOOL_PERIODS.includes(hour)) grid[`${dayNum}-${hour}`] = slot.Subject || slot.subject || '';
      }
    });
    setSchoolGrid(grid);
    setShowSchoolModal(true);
  }

  async function submitSchoolSchedule() {
    const entries = Object.entries(schoolGrid).filter(([, v]) => v.trim());
    setSchoolLoading(true);
    const auth = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };
    // Delete all existing slots
    await Promise.all(scheduleSlots.map(s =>
      fetch(`${API_URL}${API_ENDPOINTS.CHILD.DELETE_SCHEDULE(s.id)}`, { method: 'DELETE', headers: auth }).catch(() => {})
    ));
    // Create new slots
    const created: ScheduleSlot[] = [];
    for (const [key, subject] of entries) {
      const [dayIdxStr, hourStr] = key.split('-');
      const dayIdx = parseInt(dayIdxStr);
      const hour = parseInt(hourStr);
      try {
        const res = await fetch(`${API_URL}${API_ENDPOINTS.CHILD.SCHEDULE}`, {
          method: 'POST', headers: auth,
          body: JSON.stringify({
            day_of_week: DAY_NAMES[dayIdx],
            Subject: subject,
            start_time: `${String(hour).padStart(2, '0')}:00`,
            endtime: `${String(hour + 1).padStart(2, '0')}:00`,
          }),
        });
        if (res.ok) created.push(await res.json());
      } catch {}
    }
    setScheduleSlots(created);
    setSchoolLoading(false);
    setShowSchoolModal(false);
    setSchoolGrid({});
    fetchWeekData(true);
  }

  async function scheduleStudy() {
    if (!schedulerTest) return;
    setSchedulerLoading(true);
    for (const s of studySessions.filter(s => s.trim())) {
      try {
        await fetch(`${API_URL}${API_ENDPOINTS.TASKS.BOT}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `לימוד לפני מבחן: ${schedulerTest.title} בתאריך ${s}` }),
        });
      } catch {}
    }
    setSchedulerTest(null); setStudySessions(['']); setSchedulerLoading(false);
    fetchWeekData(true);
  }

  // ─── Derived ───────────────────────────────────────────────────────────────
  const wDays = weekDays(currentDate);
  const today = new Date();

  const rawVisible = view === 'day'
    ? weekAllTasks.filter(t => sameDay(new Date(t.due_date * 1000), currentDate))
    : weekAllTasks;
  const visibleTasks = sortByUrgency(rawVisible);
  const doneCnt = visibleTasks.filter(t => t.status === 'done').length;
  const pendingTasks = visibleTasks.filter(t => t.status !== 'done');
  const upcomingTests = weekAllTasks.filter(t => isTest(t) && t.status !== 'done' && daysUntil(t.due_date) >= 0);
  const heroTask = pendingTasks[0] || null;

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
              return (
                <div key={test.id} className={`test-banner${d <= 1 ? ' urgent' : ''}`}>
                  <span className="test-banner-icon">📝</span>
                  <div className="test-banner-text">
                    <strong>{test.title}</strong>
                    <span>{d === 0 ? 'היום!' : d === 1 ? 'מחר!' : `בעוד ${d} ימים`}</span>
                  </div>
                  <button className="test-banner-btn" onClick={() => { setSchedulerTest(test); setStudySessions(['']); }}>
                    תכנן לימוד
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
        {visibleTasks.length > 0 && (
          <div className="kid-progress-wrap">
            <div className="kid-progress-label">
              <span>{doneCnt} / {visibleTasks.length} הושלמו</span>
              <span>{Math.round((doneCnt / visibleTasks.length) * 100)}%</span>
            </div>
            <div className="kid-progress-bar">
              <div className="kid-progress-fill" style={{ width: `${(doneCnt / visibleTasks.length) * 100}%` }} />
            </div>
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
                              className={`sc-event ev-${task.type} urgency-${uk}${task.status === 'done' ? ' ev-done' : ''}`}
                              onClick={() => toggleStatus(task)}>
                              <span className="ev-emoji">{typeEmoji(task.type)}</span>
                              <span className={`ev-title${task.status === 'done' ? ' done' : ''}`}>{task.title}</span>
                              <button className="ev-edit" onClick={e => openEdit(task, e)}><Edit3 size={10} /></button>
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
                            }}>
                            {cellTasks.map(task => {
                              const uk = urgencyKey(task.due_date, task.status);
                              return (
                                <div key={task.id}
                                  draggable
                                  onDragStart={e => { e.dataTransfer.setData('text/plain', String(task.id)); dragTaskId.current = task.id; }}
                                  onDragEnd={() => { dragTaskId.current = null; setDragOverCell(null); }}
                                  className={`sc-event ev-${task.type} urgency-${uk}${task.status === 'done' ? ' ev-done' : ''}${isTest(task) && task.status !== 'done' ? ' ev-test' : ''}`}
                                  onClick={e => { e.stopPropagation(); toggleStatus(task); }}>
                                  <span className="ev-emoji">{typeEmoji(task.type)}</span>
                                  <span className={`ev-title${task.status === 'done' ? ' done' : ''}`}>{task.title}</span>
                                  <button className="ev-edit" onClick={e => openEdit(task, e)}><Edit3 size={10} /></button>
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

      {/* ── STUDY SCHEDULER ── */}
      {schedulerTest && (
        <div className="modal-overlay" onClick={() => setSchedulerTest(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSchedulerTest(null)}><X size={20} /></button>
            <div className="modal-header">
              <div className="modal-icon" style={{ background: 'linear-gradient(135deg, #FFD93D, #FF6B6B)' }}>
                <BookOpen size={28} color="white" />
              </div>
              <h2 className="modal-title">תכנון זמן לימוד</h2>
              <p className="modal-sub">מבחן: <strong>{schedulerTest.title}</strong></p>
            </div>
            <p style={{ color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 16, fontSize: '0.95rem' }}>
              מתי תשב ללמוד? בחר תאריך ושעה:
            </p>
            {studySessions.map((s, i) => (
              <div key={i} className="form-field" style={{ marginBottom: 12 }}>
                <label>מפגש {i + 1}</label>
                <input type="datetime-local" className="form-select" value={s}
                  onChange={e => setStudySessions(p => p.map((x, j) => j === i ? e.target.value : x))} />
              </div>
            ))}
            {studySessions.length < 3 && (
              <button className="btn-secondary" style={{ marginBottom: 16 }} onClick={() => setStudySessions(p => [...p, ''])}>
                + הוסף מפגש נוסף
              </button>
            )}
            <button className="btn-primary" onClick={scheduleStudy}
              disabled={schedulerLoading || !studySessions.some(s => s.trim())}>
              <Zap size={18} style={{ marginLeft: 8 }} />
              {schedulerLoading ? 'יוצר...' : 'צור משימות לימוד'}
            </button>
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
                      {[0, 1, 2, 3, 4].map(dayIdx => {
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
