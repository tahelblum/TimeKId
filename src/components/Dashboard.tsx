'use client';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut, UserPlus, Users } from 'lucide-react';
import { PARENT_API_URL } from '@/lib/api';

interface Child {
  id: number;
  name: string;
  username: string;
  grade: string;
  access_code: number;
}

export default function Dashboard() {
  const { user, authToken, logout, loading } = useAuth();
  const router = useRouter();
  const [children, setChildren] = useState<Child[]>([]);
  const [childrenLoading, setChildrenLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/');
    if (!loading && user && authToken) fetchChildren();
  }, [user, loading, authToken]);

  async function fetchChildren() {
    setChildrenLoading(true);
    try {
      const res = await fetch(`${PARENT_API_URL}/manage_children/get`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (res.status === 401) { logout(); router.push('/'); return; }
      if (!res.ok) throw new Error();
      const d = await res.json(); setChildren(Array.isArray(d) ? d : (d.items ?? []));
    } catch {
      setError('שגיאה בטעינת הילדים');
    } finally {
      setChildrenLoading(false);
    }
  }

  const handleLogout = () => { logout(); router.push('/'); };

  if (loading || !user) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        טוען...
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-logo">⏰ TimeKid</div>
        <div>
          <div className="dashboard-user-name">שלום, {user.name} 👋</div>
          <div className="dashboard-user-email">{user.email}</div>
        </div>
        <button className="btn-logout" onClick={handleLogout}>
          <LogOut size={18} />
          התנתק
        </button>
      </header>
      <main className="dashboard-main">
        <div className="dashboard-page-header">
          <div>
            <h2 className="dashboard-page-title">
              <Users size={36} />
              הילדים שלי
            </h2>
            <p className="dashboard-page-subtitle">נהלו את לוחות הזמנים והמשימות של הילדים שלכם</p>
          </div>
          <button className="btn-add" onClick={() => router.push('/dashboard/create-child')}>
            <UserPlus size={22} />
            הוסף ילד
          </button>
        </div>
        {error && <div className="error-box" style={{ marginBottom: 24 }}>{error}</div>}
        {childrenLoading ? (
          <div className="tasks-loading"><div className="spinner" /></div>
        ) : children.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Users size={48} color="var(--color-primary)" />
            </div>
            <h3 className="empty-title">אין ילדים רשומים</h3>
            <p className="empty-sub">התחילו על ידי הוספת הילד הראשון שלכם</p>
            <button className="btn-add btn-add-centered" onClick={() => router.push('/dashboard/create-child')}>
              <UserPlus size={22} />
              הוסף ילד
            </button>
          </div>
        ) : (
          <div className="children-grid">
            {children.map((child) => (
              <div key={child.id} className="child-card" onClick={() => router.push(`/dashboard/child/${child.id}`)}>
                <div className="child-avatar">{child.name.charAt(0)}</div>
                <div className="child-name">{child.name}</div>
                <div className="child-grade">כיתה {child.grade}</div>
                <div className="child-meta">שם משתמש: <span>{child.username}</span></div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
