'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useChildAuth } from '@/contexts/ChildAuthContext';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2, Circle, Clock, X, Send, Upload,
  FileText, Bot, ChevronLeft, ChevronRight,
  Edit3, LogOut, BookOpen, Zap, Play, Pause, Target, Paperclip,
} from 'lucide-react';
import { API_URL, API_ENDPOINTS } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Task {
  id: number;
  title: string;
  description: string;
  due_date: number;
  status: 'pending' | 'in_progress' | 'done';
  type: 'homework' | 'test' | 'activity' | 'other';
}
interface ChatMessage { role: 'user' | 'bot'; text: string; }

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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [currentDate, setCurrentDate] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });

  // Upcoming tests (7-day window)
  const [upcomingTests, setUpcomingTests] = useState<Task[]>([]);

  // Full week data for the always-visible preview (independent of day/week view)
  const [weekAllTasks, setWeekAllTasks] = useState<Task[]>([]);

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
  const [chatFile, setChatFile] = useState<File | null>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Document
  const [showDocument, setShowDocument] = useState(false);
  const [docText, setDocText] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docSuccess, setDocSuccess] = useState('');

  // ─── Data fetching ─────────────────────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const days = weekDays(currentDate);
      const start = view === 'week' ? days[0] : currentDate;
      const end = view === 'week' ? days[6] : currentDate;
      const url = `${API_URL}${API_ENDPOINTS.CHILD.MY_TASKS}?start=${toAPIDate(start)}&end=${toAPIDate(end)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) { const d = await res.json(); setTasks(Array.isArray(d) ? d : (d.items ?? [])); } else setTasks([]);
    } catch { setTasks([]); } finally { setTasksLoading(false); }
  }, [currentDate, view, authToken]);

  const fetchWeekAllTasks = useCallback(async () => {
    const days = weekDays(currentDate);
    const url = `${API_URL}${API_ENDPOINTS.CHILD.MY_TASKS}?start=${toAPIDate(days[0])}&end=${toAPIDate(days[6])}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) { const d = await res.json(); setWeekAllTasks(Array.isArray(d) ? d : (d.items ?? [])); }
    } catch {}
  }, [currentDate, authToken]);

  const fetchUpcomingTests = useCallback(async () => {
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const future = new Date(today); future.setDate(future.getDate() + 7);
      const url = `${API_URL}${API_ENDPOINTS.CHILD.MY_TASKS}?start=${toAPIDate(today)}&end=${toAPIDate(future)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) {
        const raw = await res.json(); const all: Task[] = Array.isArray(raw) ? raw : (raw.items ?? []);
        setUpcomingTests(all.filter(t => isTest(t) && t.status !== 'done' && daysUntil(t.due_date) >= 0));
      }
    } catch {}
  }, [authToken]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { fetchWeekAllTasks(); }, [fetchWeekAllTasks]);
  useEffect(() => { fetchUpcomingTests(); }, [fetchUpcomingTests]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // ─── Actions ───────────────────────────────────────────────────────────────
  async function toggleStatus(task: Task) {
    const next: Task['status'] = task.status === 'pending' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'pending';
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next } : t));
    setWeekAllTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next } : t));
    if (next === 'done') {
      setCelebration(task);
      setUpcomingTests(prev => prev.filter(t => t.id !== task.id));
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
      setTasks(prev => prev.map(t => t.id === editTask.id ? { ...t, title: editForm.title, description: editForm.description, type: editForm.type, due_date } : t));
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
      const res = await fetch(`${API_URL}${API_ENDPOINTS.TASKS.BOT}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'bot', text: data.reply || 'נוצרה משימה חדשה! ✅' }]);
      if (data.task_created) { fetchTasks(); fetchUpcomingTests(); }
    } catch {
      setChatMessages(prev => [...prev, { role: 'bot', text: 'אירעה שגיאה. נסה שוב.' }]);
    } finally { setChatLoading(false); }
  }

  async function sendChatFile() {
    if (!chatFile || chatLoading) return;
    const file = chatFile;
    setChatFile(null);
    setChatMessages(prev => [...prev, { role: 'user', text: `📎 ${file.name}` }]);
    setChatLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await fetch(`${API_URL}${API_ENDPOINTS.TASKS.FROM_DOCUMENT}`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: fd,
      });
      setChatMessages(prev => [...prev, { role: 'bot', text: 'מעולה! המשימות נוספו מהמסמך! ✅' }]);
      fetchTasks(); fetchUpcomingTests();
    } catch {
      setChatMessages(prev => [...prev, { role: 'bot', text: 'אירעה שגיאה בעיבוד הקובץ.' }]);
    } finally { setChatLoading(false); }
  }

  async function submitDocument() {
    if (!docText.trim() && !docFile) return;
    setDocLoading(true);
    try {
      const fd = new FormData();
      if (docFile) fd.append('file', docFile);
      if (docText) fd.append('text', docText);
      await fetch(`${API_URL}${API_ENDPOINTS.TASKS.FROM_DOCUMENT}`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: fd,
      });
      setDocSuccess('מעולה! המשימות נוספו מהמסמך! ✅');
      setDocText(''); setDocFile(null);
      fetchTasks(); fetchUpcomingTests();
    } catch {} finally { setDocLoading(false); }
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
    fetchTasks(); fetchUpcomingTests();
  }

  // ─── Derived ───────────────────────────────────────────────────────────────
  const wDays = weekDays(currentDate);
  const today = new Date();

  const rawVisible = view === 'day'
    ? tasks.filter(t => sameDay(new Date(t.due_date * 1000), currentDate))
    : tasks;
  const visibleTasks = sortByUrgency(rawVisible);
  const doneCnt = visibleTasks.filter(t => t.status === 'done').length;
  const pendingTasks = visibleTasks.filter(t => t.status !== 'done');
  const heroTask = pendingTasks[0] || null;

  const dateLabel = view === 'day'
    ? `${HEBREW_DAYS[currentDate.getDay()]}, ${currentDate.getDate()} ${HEBREW_MONTHS[currentDate.getMonth()]}`
    : `${wDays[0].getDate()}–${wDays[6].getDate()} ${HEBREW_MONTHS[wDays[6].getMonth()]}`;

  const navDate = (delta: number) => setCurrentDate(prev => {
    const d = new Date(prev); d.setDate(d.getDate() + delta); return d;
  });

  const typeEmoji = (t: Task['type']) => ({ homework: '📚', test: '📝', activity: '🎨', other: '✏️' }[t]);
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
            <button className={`kid-view-btn${view === 'week' ? ' active' : ''}`} onClick={() => setView('week')}>כל השבוע</button>
          </div>
          <span className="kid-date-label" style={{ flex: 1, textAlign: 'center' }}>{dateLabel}</span>
          <button className="kid-today-btn" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setCurrentDate(d); }}>היום</button>
        </div>

        {/* ── TASK LIST ── */}
        <div className="kid-tasks-section">
          <div className="kid-tasks-header">
            <h2 className="kid-tasks-title">כל המשימות</h2>
            <span className="kid-tasks-count">{visibleTasks.length}</span>
          </div>

          {tasksLoading ? (
            <div className="tasks-loading"><div className="spinner" /></div>
          ) : visibleTasks.length === 0 ? (
            <div className="kid-empty">
              <div className="kid-empty-emoji">🎉</div>
              <div className="kid-empty-title">אין משימות!</div>
              <div className="kid-empty-sub">כל הכבוד, אין לך משימות לתקופה זו</div>
            </div>
          ) : (
            <div className="kid-task-list">
              {visibleTasks.map(task => {
                const uk = urgencyKey(task.due_date, task.status);
                return (
                  <div key={task.id} className={`kid-task urgency-${uk}${isTest(task) && uk !== 'done' ? ' is-test' : ''}`}
                    onClick={() => toggleStatus(task)}>
                    <div className="kid-task-left">
                      <div className="kid-task-check">{statusIcon(task.status)}</div>
                    </div>
                    <div className="kid-task-body">
                      <div className="kid-task-title-row">
                        <span className="kid-task-emoji">{typeEmoji(task.type)}</span>
                        <span className={`kid-task-title${task.status === 'done' ? ' done' : ''}`}>{task.title}</span>
                        {uk !== 'done' && uk !== 'later' && (
                          <span className={`urgency-chip chip-${uk}`}>{urgencyLabel[uk]}</span>
                        )}
                      </div>
                      {task.description && <div className="kid-task-desc">{task.description}</div>}
                      <div className="kid-task-footer">
                        <span className="kid-task-reldate">{relativeDate(task.due_date)}</span>
                      </div>
                    </div>
                    <div className="kid-task-actions">
                      {task.status !== 'done' && (
                        <button className="kid-focus-mini" onClick={e => openFocus(task, e)} title="התמקד">
                          <Play size={13} />
                        </button>
                      )}
                      <button className="kid-edit-btn" onClick={e => openEdit(task, e)} title="עריכה">
                        <Edit3 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* ── FAB BAR ── */}
      <div className="kid-fab-bar">
        <button className="kid-fab kid-fab-chat" onClick={() => setShowChat(true)}>
          <Bot size={22} /><span>צ&apos;אט</span>
        </button>
        <button className="kid-fab kid-fab-doc" onClick={() => { setDocSuccess(''); setShowDocument(true); }}>
          <FileText size={22} /><span>מסמך</span>
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
            {chatFile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--color-bg)', borderRadius: 8, margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--color-primary)' }}>
                <Paperclip size={14} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chatFile.name}</span>
                <button onClick={() => setChatFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><X size={14} /></button>
              </div>
            )}
            <div className="chat-input-row">
              <input ref={chatFileRef} type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" style={{ display: 'none' }}
                onChange={e => { setChatFile(e.target.files?.[0] || null); if (chatFileRef.current) chatFileRef.current.value = ''; }} />
              <button className="chat-send" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}
                onClick={() => chatFileRef.current?.click()} disabled={chatLoading} title="צרף קובץ">
                <Paperclip size={18} />
              </button>
              <input type="text" className="chat-input"
                placeholder="לדוגמה: מבחן במתמטיקה ביום שלישי..."
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (chatFile ? sendChatFile() : sendChat())} />
              <button className="chat-send" onClick={chatFile ? sendChatFile : sendChat} disabled={chatLoading}><Send size={18} /></button>
            </div>
          </div>
        </div>
      )}

      {/* ── DOCUMENT ── */}
      {showDocument && (
        <div className="modal-overlay" onClick={() => setShowDocument(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowDocument(false)}><X size={20} /></button>
            <div className="modal-header">
              <div className="modal-icon modal-icon-doc"><FileText size={28} color="white" /></div>
              <h2 className="modal-title">הוסף מסמך</h2>
              <p className="modal-sub">העלה קובץ שיעורים ואני אמצא את המשימות</p>
            </div>
            {docSuccess ? (
              <div className="success-box">{docSuccess}</div>
            ) : (
              <>
                <div className="upload-area" onClick={() => document.getElementById('kid-file-upload')?.click()}>
                  <Upload size={32} color="var(--color-primary)" />
                  <p>{docFile ? docFile.name : 'לחץ להעלאת קובץ (PDF, Word, תמונה)'}</p>
                  <input id="kid-file-upload" type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                    style={{ display: 'none' }} onChange={e => setDocFile(e.target.files?.[0] || null)} />
                </div>
                <div className="modal-divider">או</div>
                <div className="form-field">
                  <label>הדבק טקסט</label>
                  <textarea className="form-textarea" value={docText} onChange={e => setDocText(e.target.value)}
                    placeholder="הדבק כאן שיעורי בית, רשימת משימות..." rows={4} />
                </div>
                <button className="btn-primary" onClick={submitDocument}
                  disabled={docLoading || (!docText.trim() && !docFile)}>
                  {docLoading ? 'מעבד...' : 'צור משימות מהמסמך'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
