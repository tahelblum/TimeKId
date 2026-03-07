'use client';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut, UserPlus, Users } from 'lucide-react';

interface Child {
  id: number;
  name: string;
  username: string;
  grade: string;
  access_code: number;
}

export default function Dashboard() {
  const { user, logout, loading } = useAuth();
  const router = useRouter();
  const [children, setChildren] = useState<Child[]>([]);

  useEffect(() => {
    if (!loading && !user) router.push('/');
  }, [user, loading, router]);

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
        {children.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Users size={48} color="var(--color-primary)" />
            </div>
            <h3 className="empty-title">אין ילדים רשומים</h3>
            <p className="empty-sub">התחילו על ידי הוספת הילד הראשון שלכם</p>
            <button className="btn-add" style={{margin: '0 auto', display: 'flex'}} onClick={() => router.push('/dashboard/create-child')}>
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
