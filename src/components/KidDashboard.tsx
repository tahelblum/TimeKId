'use client';

import { useEffect, useState, useRef } from 'react';
import { useChildAuth } from '@/contexts/ChildAuthContext';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2, Circle, Clock, X, Send, Upload,
  FileText, Bot, ChevronLeft, ChevronRight,
  Edit3, LogOut, BookOpen, Zap,
} from 'lucide-react';
import { API_URL, API_ENDPOINTS } from '@/lib/api';

interface Task {
  id: number;
  title: string;
  description: string;
  due_date: number;
  status: 'pending' | 'in_progress' | 'done';
  type: 'homework' | 'test' | 'activity' | 'other';
}

interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
}

const ENCOURAGING = [
  'אתה פגז! 🔥', 'מדהים! המשך כך! ⭐', 'כל הכבוד! אתה מצטיין! 🏆',
  'וואו! איזה הישג! 🎯', 'אתה מדהים! 💫', 'ניצחון! 🥇', 'סופר! 🎉',
];

const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function weekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekDays(date: Date): Date[] {
  const s = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(s); d.setDate(d.getDate() + i); return d;
  });
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toAPIDate(d: Date) { return d.toISOString().split('T')[0]; }

function isTest(task: Task) {
  const kw = ['מבחן', 'בוחן', 'טסט', 'בחינה'];
  return task.type === 'test' || kw.some(k => task.title.includes(k));
}

function daysUntil(ts: number) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const due = new Date(ts * 1000); due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / 86400000);
}

function tsFromDateStr(s: string) {
  return Math.floor(new Date(s + 'T12:00:00').getTime() / 1000);
}

function dateStrFromTs(ts: number) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function KidDashboard() {
  const { child, authToken, logout } = useChildAuth();
  const router = useRouter();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  });

  const [upcomingTests, setUpcomingTests] = useState<Task[]>([]);
  const [celebration, setCelebration] = useState<Task | null>(null);
  const [celebMsg] = useState(() => ENCOURAGING[Math.floor(Math.random() * ENCOURAGING.length)]);

  // Edit
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
    { role: 'bot', text: 'שלום! אני עוזר לך להוסיף משימות. ספר לי מה צריך לעשות! 📚' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Document
  const [showDocument, setShowDocument] = useState(false);
  const [docText, setDocText] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docSuccess, setDocSuccess] = useState('');

  useEffect(() => { fetchTasks(); }, [currentDate, view]);
  useEffect(() => { fetchUpcomingTests(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);
  useEffect(() => {
    if (celebration) {
      const t = setTimeout(() => setCelebration(null), 3000);
      return () => clearTimeout(t);
    }
  }, [celebration]);

  async function fetchTasks() {
    setTasksLoading(true);
    try {
      const days = weekDays(currentDate);
      const start = view === 'week' ? days[0] : currentDate;
      const end = view === 'week' ? days[6] : currentDate;
      const url = `${API_URL}${API_ENDPOINTS.CHILD.MY_TASKS}?start=${toAPIDate(start)}&end=${toAPIDate(end)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) setTasks(await res.json());
      else setTasks([]);
    } catch { setTasks([]); } finally { setTasksLoading(false); }
  }

  async function fetchUpcomingTests() {
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const future = new Date(today); future.setDate(future.getDate() + 7);
      const url = `${API_URL}${API_ENDPOINTS.CHILD.MY_TASKS}?start=${toAPIDate(today)}&end=${toAPIDate(future)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) {
        const all: Task[] = await res.json();
        setUpcomingTests(all.filter(t => isTest(t) && t.status !== 'done' && daysUntil(t.due_date) >= 0 && daysUntil(t.due_date) <= 5));
      }
    } catch {}
  }

  async function toggleStatus(task: Task) {
    const next: Task['status'] = task.status === 'pending' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'pending';
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next } : t));
    if (next === 'done') {
      setCelebration(task);
      setUpcomingTests(prev => prev.filter(t => t.id !== task.id));
    }
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILD.UPDATE_TASK(task.id)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
    } catch {}
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
      setEditTask(null);
    } catch {} finally { setEditLoading(false); }
  }

  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
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

  async function submitDocument() {
    if (!docText.trim() && !docFile) return;
    setDocLoading(true);
    try {
      const formData = new FormData();
      if (docFile) formData.append('file', docFile);
      if (docText) formData.append('text', docText);
      await fetch(`${API_URL}${API_ENDPOINTS.TASKS.FROM_DOCUMENT}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      });
      setDocSuccess('מעולה! המשימות נוספו מהמסמך! ✅');
      setDocText(''); setDocFile(null);
      fetchTasks(); fetchUpcomingTests();
    } catch {} finally { setDocLoading(false); }
  }

  async function scheduleStudy() {
    if (!schedulerTest) return;
    setSchedulerLoading(true);
    const sessions = studySessions.filter(s => s.trim());
    for (const session of sessions) {
      const msg = `לימוד לפני מבחן: ${schedulerTest.title} בתאריך ${session}`;
      try {
        await fetch(`${API_URL}${API_ENDPOINTS.TASKS.BOT}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg }),
        });
      } catch {}
    }
    setSchedulerTest(null);
    setStudySessions(['']);
    setSchedulerLoading(false);
    fetchTasks(); fetchUpcomingTests();
  }

  const wDays = weekDays(currentDate);
  const today = new Date();
  const visibleTasks = view === 'day'
    ? tasks.filter(t => sameDay(new Date(t.due_date * 1000), currentDate))
    : tasks;

  const dateLabel = view === 'day'
    ? `${HEBREW_DAYS[currentDate.getDay()]}, ${currentDate.getDate()} ${HEBREW_MONTHS[currentDate.getMonth()]}`
    : `${wDays[0].getDate()}–${wDays[6].getDate()} ${HEBREW_MONTHS[wDays[6].getMonth()]}`;

  const navDate = (delta: number) => setCurrentDate(prev => {
    const d = new Date(prev); d.setDate(d.getDate() + delta); return d;
  });

  const typeEmoji = (t: Task['type']) => ({ homework: '📚', test: '📝', activity: '🎨', other: '✏️' }[t]);

  const statusIcon = (s: Task['status']) => {
    if (s === 'done') return <CheckCircle2 size={26} color="#6BCB77" />;
    if (s === 'in_progress') return <Clock size={26} color="#74B9FF" />;
    return <Circle size={26} color="#C4BEFF" />;
  };

  const statusLabel = (s: Task['status']) => ({ done: 'הושלם ✅', in_progress: 'בתהליך ⏳', pending: 'ממתין' }[s]);

  return (
    <div className="kid-app">
      {/* Header */}
      <header className="kid-header">
        <div className="kid-avatar">{child?.name?.charAt(0)}</div>
        <div className="kid-header-info">
          <div className="kid-header-name">שלום, {child?.name}! 👋</div>
          <div className="kid-header-grade">כיתה {child?.grade}</div>
        </div>
        <button className="kid-logout-btn" onClick={() => { logout(); router.push('/child-app'); }} title="יציאה">
          <LogOut size={18} />
        </button>
      </header>

      <main className="kid-main">

        {/* Test reminder banners */}
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

        {/* Calendar controls */}
        <div className="kid-cal-controls">
          <div className="kid-view-toggle">
            <button className={`kid-view-btn${view === 'day' ? ' active' : ''}`} onClick={() => setView('day')}>יום</button>
            <button className={`kid-view-btn${view === 'week' ? ' active' : ''}`} onClick={() => setView('week')}>שבוע</button>
          </div>
          <div className="kid-cal-nav">
            <button className="kid-nav-arrow" onClick={() => navDate(view === 'week' ? -7 : -1)}><ChevronRight size={20} /></button>
            <span className="kid-date-label">{dateLabel}</span>
            <button className="kid-nav-arrow" onClick={() => navDate(view === 'week' ? 7 : 1)}><ChevronLeft size={20} /></button>
          </div>
          <button className="kid-today-btn" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setCurrentDate(d); }}>היום</button>
        </div>

        {/* Week strip */}
        {view === 'week' && (
          <div className="kid-week-strip">
            {wDays.map((day, i) => {
              const cnt = tasks.filter(t => sameDay(new Date(t.due_date * 1000), day)).length;
              return (
                <div key={i} className={`kid-week-day${sameDay(day, today) ? ' today' : ''}`} onClick={() => { setCurrentDate(day); setView('day'); }}>
                  <div className="kid-wday-name">{HEBREW_DAYS[day.getDay()]}</div>
                  <div className="kid-wday-num">{day.getDate()}</div>
                  {cnt > 0 && <div className="kid-wday-dot">{cnt}</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* Progress bar */}
        {visibleTasks.length > 0 && (
          <div className="kid-progress-wrap">
            <div className="kid-progress-label">
              <span>{visibleTasks.filter(t => t.status === 'done').length} / {visibleTasks.length} הושלמו</span>
              <span>{Math.round((visibleTasks.filter(t => t.status === 'done').length / visibleTasks.length) * 100)}%</span>
            </div>
            <div className="kid-progress-bar">
              <div
                className="kid-progress-fill"
                style={{ width: `${(visibleTasks.filter(t => t.status === 'done').length / visibleTasks.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Tasks */}
        <div className="kid-tasks-section">
          <div className="kid-tasks-header">
            <h2 className="kid-tasks-title">המשימות שלי</h2>
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
              {visibleTasks.map(task => (
                <div key={task.id} className={`kid-task kid-task-${task.status}${isTest(task) ? ' kid-task-test' : ''}`} onClick={() => toggleStatus(task)}>
                  <div className="kid-task-check">{statusIcon(task.status)}</div>
                  <div className="kid-task-body">
                    <div className="kid-task-title-row">
                      <span className="kid-task-emoji">{typeEmoji(task.type)}</span>
                      <span className={`kid-task-title${task.status === 'done' ? ' done' : ''}`}>{task.title}</span>
                    </div>
                    {task.description && <div className="kid-task-desc">{task.description}</div>}
                    <div className="kid-task-footer">
                      <span className="kid-task-date">
                        {new Date(task.due_date * 1000).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </span>
                      <span className={`kid-task-badge kid-badge-${task.status}`}>{statusLabel(task.status)}</span>
                    </div>
                  </div>
                  <button className="kid-edit-btn" onClick={e => openEdit(task, e)} title="עריכה">
                    <Edit3 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* FAB bar */}
      <div className="kid-fab-bar">
        <button className="kid-fab kid-fab-chat" onClick={() => { setShowChat(true); }}>
          <Bot size={22} />
          <span>צ&apos;אט</span>
        </button>
        <button className="kid-fab kid-fab-doc" onClick={() => { setDocSuccess(''); setShowDocument(true); }}>
          <FileText size={22} />
          <span>מסמך</span>
        </button>
      </div>

      {/* ===== CELEBRATION OVERLAY ===== */}
      {celebration && (
        <div className="celebration-overlay" onClick={() => setCelebration(null)}>
          <div className="celebration-card">
            <div className="celebration-big-emoji">🎉</div>
            <div className="celebration-title">כל הכבוד!</div>
            <div className="celebration-task-name">{celebration.title}</div>
            <div className="celebration-msg">{celebMsg}</div>
            <div className="celebration-stars">⭐ ⭐ ⭐</div>
          </div>
        </div>
      )}

      {/* ===== EDIT TASK MODAL ===== */}
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

      {/* ===== STUDY SCHEDULER MODAL ===== */}
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
              בחר מתי תלמד לפני המבחן:
            </p>
            {studySessions.map((s, i) => (
              <div key={i} className="form-field" style={{ marginBottom: 12 }}>
                <label>מפגש לימוד {i + 1}</label>
                <input
                  type="datetime-local"
                  className="form-select"
                  value={s}
                  onChange={e => setStudySessions(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                />
              </div>
            ))}
            {studySessions.length < 3 && (
              <button className="btn-secondary" style={{ marginBottom: 16 }} onClick={() => setStudySessions(p => [...p, ''])}>
                + הוסף מפגש נוסף
              </button>
            )}
            <button
              className="btn-primary"
              onClick={scheduleStudy}
              disabled={schedulerLoading || !studySessions.some(s => s.trim())}
            >
              <Zap size={18} style={{ marginLeft: 8 }} />
              {schedulerLoading ? 'יוצר...' : 'צור משימות לימוד'}
            </button>
          </div>
        </div>
      )}

      {/* ===== CHAT MODAL ===== */}
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
              <input
                type="text"
                className="chat-input"
                placeholder="לדוגמה: מבחן במתמטיקה ביום שלישי..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()}
              />
              <button className="chat-send" onClick={sendChat} disabled={chatLoading}><Send size={18} /></button>
            </div>
          </div>
        </div>
      )}

      {/* ===== DOCUMENT MODAL ===== */}
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
                  <input
                    id="kid-file-upload"
                    type="file"
                    accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                    style={{ display: 'none' }}
                    onChange={e => setDocFile(e.target.files?.[0] || null)}
                  />
                </div>
                <div className="modal-divider">או</div>
                <div className="form-field">
                  <label>הדבק טקסט</label>
                  <textarea className="form-textarea" value={docText} onChange={e => setDocText(e.target.value)} placeholder="הדבק כאן שיעורי בית, רשימת משימות..." rows={4} />
                </div>
                <button className="btn-primary" onClick={submitDocument} disabled={docLoading || (!docText.trim() && !docFile)}>
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
