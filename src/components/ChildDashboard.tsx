'use client';
import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, ChevronLeft, ChevronRight,
  Bot, FileText, Star, Bell, UserPlus,
  CheckCircle2, Circle, Clock, X, Send, Upload, Paperclip,
} from 'lucide-react';
import { API_URL, API_ENDPOINTS } from '@/lib/api';

interface Task {
  id: number;
  title: string;
  description: string;
  due_date: number;
  status: 'pending' | 'in_progress' | 'done';
  type: 'homework' | 'activity' | 'other';
}

interface Child {
  id: number;
  name: string;
  username: string;
  grade: string;
}

interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
}

const HEBREW_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDays(date: Date): Date[] {
  const start = getWeekStart(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatDateForAPI(date: Date): string {
  return date.toISOString().split('T')[0];
}

export default function ChildDashboard({ childId }: { childId: number }) {
  const { authToken } = useAuth();
  const router = useRouter();
  const [child, setChild] = useState<Child | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [activeModal, setActiveModal] = useState<null | 'bot' | 'document' | 'compliment' | 'reminder' | 'secondary'>(null);

  // Bot
  const [botMessages, setBotMessages] = useState<ChatMessage[]>([
    { role: 'bot', text: 'שלום! תאר לי משימה ואני אדאג ליצור אותה. לדוגמה: "שיעורי בית במתמטיקה ליום שלישי"' },
  ]);
  const [botInput, setBotInput] = useState('');
  const [botLoading, setBotLoading] = useState(false);
  const [botFile, setBotFile] = useState<File | null>(null);
  const botFileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Action modals shared state
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState('');

  // Compliment
  const [complimentText, setComplimentText] = useState('');

  // Reminder
  const [reminderText, setReminderText] = useState('');
  const [reminderDate, setReminderDate] = useState('');

  // Secondary parent
  const [secondaryEmail, setSecondaryEmail] = useState('');

  // Document
  const [documentText, setDocumentText] = useState('');
  const [documentFile, setDocumentFile] = useState<File | null>(null);

  useEffect(() => { fetchChild(); }, [childId]);
  useEffect(() => { fetchTasks(); }, [childId, currentDate, view]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [botMessages]);

  async function fetchChild() {
    try {
      const res = await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.GET(childId)}`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (res.ok) setChild(await res.json());
    } catch {}
  }

  async function fetchTasks() {
    setTasksLoading(true);
    try {
      const weekDays = getWeekDays(currentDate);
      const start = view === 'week' ? weekDays[0] : currentDate;
      const end = view === 'week' ? weekDays[6] : currentDate;
      const url = `${API_URL}${API_ENDPOINTS.CHILDREN.TASKS(childId)}?start=${formatDateForAPI(start)}&end=${formatDateForAPI(end)}`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${authToken}` } });
      if (res.ok) { const d = await res.json(); setTasks(Array.isArray(d) ? d : (d.items ?? [])); }
      else setTasks([]);
    } catch {
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }

  async function toggleTaskStatus(task: Task) {
    const next: Task['status'] = task.status === 'pending' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'pending';
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next } : t));
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.UPDATE_TASK(childId, task.id)}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
    } catch {}
  }

  async function sendBotMessage() {
    if (!botInput.trim() || botLoading) return;
    const msg = botInput.trim();
    setBotInput('');
    setBotMessages(prev => [...prev, { role: 'user', text: msg }]);
    setBotLoading(true);
    try {
      const res = await fetch(`${API_URL}${API_ENDPOINTS.TASKS.BOT}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, child_id: childId }),
      });
      const data = await res.json();
      setBotMessages(prev => [...prev, { role: 'bot', text: data.reply || 'המשימה נוצרה בהצלחה!' }]);
      if (data.task_created) fetchTasks();
    } catch {
      setBotMessages(prev => [...prev, { role: 'bot', text: 'מצטער, אירעה שגיאה. נסה שוב.' }]);
    } finally {
      setBotLoading(false);
    }
  }

  async function sendBotFile() {
    if (!botFile || botLoading) return;
    const file = botFile;
    setBotFile(null);
    setBotMessages(prev => [...prev, { role: 'user', text: `📎 ${file.name}` }]);
    setBotLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('child_id', String(childId));
      await fetch(`${API_URL}${API_ENDPOINTS.TASKS.FROM_DOCUMENT}`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: fd,
      });
      setBotMessages(prev => [...prev, { role: 'bot', text: 'מעולה! המשימות נוספו מהמסמך! ✅' }]);
      fetchTasks();
    } catch {
      setBotMessages(prev => [...prev, { role: 'bot', text: 'שגיאה בעיבוד הקובץ. נסה שוב.' }]);
    } finally { setBotLoading(false); }
  }

  async function sendCompliment() {
    if (!complimentText.trim()) return;
    setActionLoading(true);
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.COMPLIMENT(childId)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: complimentText }),
      });
      setActionSuccess('המחמאה נשלחה לילד!');
      setComplimentText('');
    } catch {
      setActionSuccess('');
    } finally {
      setActionLoading(false);
    }
  }

  async function sendReminder() {
    if (!reminderText.trim()) return;
    setActionLoading(true);
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.REMINDER(childId)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reminderText, scheduled_at: reminderDate }),
      });
      setActionSuccess('התזכורת נשלחה בהצלחה!');
      setReminderText('');
      setReminderDate('');
    } catch {
      setActionSuccess('');
    } finally {
      setActionLoading(false);
    }
  }

  async function addSecondaryParent() {
    if (!secondaryEmail.trim()) return;
    setActionLoading(true);
    try {
      await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.SECONDARY_PARENT(childId)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: secondaryEmail }),
      });
      setActionSuccess('הזמנה נשלחה להורה השני!');
      setSecondaryEmail('');
    } catch {
      setActionSuccess('');
    } finally {
      setActionLoading(false);
    }
  }

  async function submitDocument() {
    if (!documentText.trim() && !documentFile) return;
    setActionLoading(true);
    try {
      const formData = new FormData();
      formData.append('child_id', String(childId));
      if (documentFile) formData.append('file', documentFile);
      if (documentText) formData.append('text', documentText);
      await fetch(`${API_URL}${API_ENDPOINTS.TASKS.FROM_DOCUMENT}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData,
      });
      setActionSuccess('המסמך נטען ומשימות נוצרו בהצלחה!');
      setDocumentText('');
      setDocumentFile(null);
      fetchTasks();
    } catch {
      setActionSuccess('');
    } finally {
      setActionLoading(false);
    }
  }

  function closeModal() {
    setActiveModal(null);
    setActionSuccess('');
    setActionLoading(false);
  }

  function navigatePrev() {
    setCurrentDate(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() - (view === 'week' ? 7 : 1));
      return d;
    });
  }

  function navigateNext() {
    setCurrentDate(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + (view === 'week' ? 7 : 1));
      return d;
    });
  }

  function goToToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setCurrentDate(d);
  }

  const weekDays = getWeekDays(currentDate);
  const today = new Date();

  const visibleTasks = view === 'day'
    ? tasks.filter(t => sameDay(new Date(t.due_date * 1000), currentDate))
    : tasks;

  const dateLabel = view === 'day'
    ? `${HEBREW_DAY_NAMES[currentDate.getDay()]}, ${currentDate.getDate()} ${HEBREW_MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : `${weekDays[0].getDate()}–${weekDays[6].getDate()} ${HEBREW_MONTHS[weekDays[6].getMonth()]} ${weekDays[6].getFullYear()}`;

  const statusIcon = (status: Task['status']) => {
    if (status === 'done') return <CheckCircle2 size={22} color="var(--color-success)" />;
    if (status === 'in_progress') return <Clock size={22} color="var(--color-secondary)" />;
    return <Circle size={22} color="var(--color-text-muted)" />;
  };

  const statusLabel = (status: Task['status']) => {
    if (status === 'done') return 'הושלם';
    if (status === 'in_progress') return 'בתהליך';
    return 'ממתין';
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <button className="btn-back" onClick={() => router.push('/dashboard')}>
          <ArrowRight size={20} />
          חזרה
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
          <UserPlus size={18} />
          הורה שני
        </button>
      </header>

      <main className="dashboard-main" style={{ paddingBottom: 120 }}>
        {/* View toggle + calendar nav */}
        <div className="calendar-controls">
          <div className="view-toggle">
            <button className={`view-btn${view === 'day' ? ' active' : ''}`} onClick={() => setView('day')}>יום</button>
            <button className={`view-btn${view === 'week' ? ' active' : ''}`} onClick={() => setView('week')}>שבוע</button>
          </div>
          <div className="calendar-nav">
            <button className="nav-arrow" onClick={navigatePrev}><ChevronRight size={20} /></button>
            <span className="calendar-date-label">{dateLabel}</span>
            <button className="nav-arrow" onClick={navigateNext}><ChevronLeft size={20} /></button>
          </div>
          <button className="btn-today" onClick={goToToday}>היום</button>
        </div>

        {/* Week strip */}
        {view === 'week' && (
          <div className="week-strip">
            {weekDays.map((day, i) => {
              const dayTaskCount = tasks.filter(t => sameDay(new Date(t.due_date * 1000), day)).length;
              const isToday = sameDay(day, today);
              return (
                <div
                  key={i}
                  className={`week-day${isToday ? ' today' : ''}`}
                  onClick={() => { setCurrentDate(day); setView('day'); }}
                >
                  <div className="week-day-name">{HEBREW_DAY_NAMES[day.getDay()]}</div>
                  <div className="week-day-num">{day.getDate()}</div>
                  {dayTaskCount > 0 && <div className="week-day-dot">{dayTaskCount}</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* Tasks */}
        <div className="tasks-section">
          <div className="tasks-header">
            <h2 className="tasks-title">משימות</h2>
            <span className="tasks-count">{visibleTasks.length} משימות</span>
          </div>
          {tasksLoading ? (
            <div className="tasks-loading"><div className="spinner" /></div>
          ) : visibleTasks.length === 0 ? (
            <div className="empty-state" style={{ padding: '48px 24px' }}>
              <div className="empty-icon"><CheckCircle2 size={40} color="var(--color-primary)" /></div>
              <h3 className="empty-title">אין משימות</h3>
              <p className="empty-sub">אין משימות לתקופה זו. השתמש בבוט כדי להוסיף!</p>
            </div>
          ) : (
            <div className="tasks-list">
              {visibleTasks.map(task => (
                <div
                  key={task.id}
                  className={`task-item task-${task.status}`}
                  onClick={() => toggleTaskStatus(task)}
                >
                  <div className="task-status-icon">{statusIcon(task.status)}</div>
                  <div className="task-content">
                    <div className="task-title">{task.title}</div>
                    {task.description && <div className="task-desc">{task.description}</div>}
                    <div className="task-due">
                      {new Date(task.due_date * 1000).toLocaleDateString('he-IL', {
                        weekday: 'short', day: 'numeric', month: 'short',
                      })}
                    </div>
                  </div>
                  <div className={`task-badge task-badge-${task.status}`}>{statusLabel(task.status)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* FAB action bar */}
      <div className="fab-panel">
        <button className="fab-btn fab-bot" onClick={() => { setActionSuccess(''); setActiveModal('bot'); }}>
          <Bot size={22} />
          <span>בוט</span>
        </button>
        <button className="fab-btn fab-doc" onClick={() => { setActionSuccess(''); setActiveModal('document'); }}>
          <FileText size={22} />
          <span>מסמך</span>
        </button>
        <button className="fab-btn fab-star" onClick={() => { setActionSuccess(''); setActiveModal('compliment'); }}>
          <Star size={22} />
          <span>מחמאה</span>
        </button>
        <button className="fab-btn fab-bell" onClick={() => { setActionSuccess(''); setActiveModal('reminder'); }}>
          <Bell size={22} />
          <span>תזכורת</span>
        </button>
      </div>

      {/* Modals */}
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
                    <div key={i} className={`chat-bubble chat-bubble-${msg.role}`}>
                      <span>{msg.text}</span>
                    </div>
                  ))}
                  {botLoading && (
                    <div className="chat-bubble chat-bubble-bot">
                      <span className="typing-dots"><span>.</span><span>.</span><span>.</span></span>
                    </div>
                  )}
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
                  <input
                    type="text"
                    className="chat-input"
                    placeholder="לדוגמה: שיעורי בית במתמטיקה ליום שני..."
                    value={botInput}
                    onChange={e => setBotInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (botFile ? sendBotFile() : sendBotMessage())}
                  />
                  <button className="chat-send" onClick={botFile ? sendBotFile : sendBotMessage} disabled={botLoading}>
                    <Send size={18} />
                  </button>
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
                {actionSuccess ? (
                  <div className="success-box">{actionSuccess}</div>
                ) : (
                  <>
                    <div className="upload-area" onClick={() => document.getElementById('file-upload')?.click()}>
                      <Upload size={32} color="var(--color-primary)" />
                      <p>{documentFile ? documentFile.name : 'לחץ להעלאת קובץ (PDF, Word, תמונה)'}</p>
                      <input
                        id="file-upload"
                        type="file"
                        accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                        style={{ display: 'none' }}
                        onChange={e => setDocumentFile(e.target.files?.[0] || null)}
                      />
                    </div>
                    <div className="modal-divider">או</div>
                    <div className="form-field">
                      <label>הדבק טקסט</label>
                      <textarea
                        className="form-textarea"
                        value={documentText}
                        onChange={e => setDocumentText(e.target.value)}
                        placeholder="הדבק כאן שיעורי בית, רשימת משימות..."
                        rows={4}
                      />
                    </div>
                    <button
                      className="btn-primary"
                      onClick={submitDocument}
                      disabled={actionLoading || (!documentText.trim() && !documentFile)}
                    >
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
                {actionSuccess ? (
                  <div className="success-box">{actionSuccess}</div>
                ) : (
                  <>
                    <div className="quick-chips">
                      {['כל הכבוד! 🌟', 'עבודה מצוינת! ⭐', 'אני גאה בך! 💫', 'המשך כך! 💪', 'אתה מדהים! 🎉'].map(c => (
                        <button key={c} className="chip" onClick={() => setComplimentText(c)}>{c}</button>
                      ))}
                    </div>
                    <div className="form-field" style={{ marginTop: 16 }}>
                      <label>מחמאה אישית</label>
                      <textarea
                        className="form-textarea"
                        value={complimentText}
                        onChange={e => setComplimentText(e.target.value)}
                        placeholder="כתוב מחמאה אישית..."
                        rows={3}
                      />
                    </div>
                    <button
                      className="btn-primary"
                      onClick={sendCompliment}
                      disabled={actionLoading || !complimentText.trim()}
                    >
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
                {actionSuccess ? (
                  <div className="success-box">{actionSuccess}</div>
                ) : (
                  <>
                    <div className="quick-chips">
                      {['אל תשכח שיעורי בית!', 'זמן ללמוד!', 'יש משימה שמחכה לך'].map(c => (
                        <button key={c} className="chip" onClick={() => setReminderText(c)}>{c}</button>
                      ))}
                    </div>
                    <div className="form-field" style={{ marginTop: 16 }}>
                      <label>תוכן התזכורת</label>
                      <textarea
                        className="form-textarea"
                        value={reminderText}
                        onChange={e => setReminderText(e.target.value)}
                        placeholder="לדוגמה: אל תשכח לסיים שיעורי הבית!"
                        rows={3}
                      />
                    </div>
                    <div className="form-field">
                      <label>תאריך ושעה (אופציונלי)</label>
                      <input
                        type="datetime-local"
                        className="form-select"
                        value={reminderDate}
                        onChange={e => setReminderDate(e.target.value)}
                      />
                    </div>
                    <button
                      className="btn-primary"
                      onClick={sendReminder}
                      disabled={actionLoading || !reminderText.trim()}
                    >
                      {actionLoading ? 'שולח...' : 'שלח תזכורת'}
                    </button>
                  </>
                )}
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
                {actionSuccess ? (
                  <div className="success-box">{actionSuccess}</div>
                ) : (
                  <>
                    <div className="form-field">
                      <label>אימייל ההורה השני</label>
                      <input
                        type="email"
                        className="form-select"
                        value={secondaryEmail}
                        onChange={e => setSecondaryEmail(e.target.value)}
                        placeholder="parent@email.com"
                      />
                    </div>
                    <button
                      className="btn-primary"
                      onClick={addSecondaryParent}
                      disabled={actionLoading || !secondaryEmail.trim()}
                    >
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
