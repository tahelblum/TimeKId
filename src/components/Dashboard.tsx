'use client';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('dashboard');

  useEffect(() => {
    if (!loading && !user) router.push('/');
  }, [user, loading, router]);

  const handleLogout = () => { logout(); router.push('/'); };

  if (loading || !user) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        {t('loading')}
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-logo">⏰ TimeKid</div>
        <div>
          <div className="dashboard-user-name">{t('hello')}, {user.name} 👋</div>
          <div className="dashboard-user-email">{user.email}</div>
        </div>
        <button className="btn-logout" onClick={handleLogout}>
          <LogOut size={18} />
          {t('logout')}
        </button>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-page-header">
          <div>
            <h2 className="dashboard-page-title">
              <Users size={36} />
              {t('myChildren')}
            </h2>
            <p className="dashboard-page-subtitle">{t('subtitle')}</p>
          </div>
          <button className="btn-add" onClick={() => router.push('/dashboard/create-child')}>
            <UserPlus size={22} />
            {t('addChild')}
          </button>
        </div>

        {children.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Users size={48} color="var(--color-primary)" />
            </div>
            <h3 className="empty-title">{t('noChildren')}</h3>
            <p className="empty-sub">{t('noChildrenSubtitle')}</p>
            <button className="btn-add" style={{margin: '0 auto', display: 'flex'}} onClick={() => router.push('/dashboard/create-child')}>
              <UserPlus size={22} />
              {t('addChild')}
            </button>
          </div>
        ) : (
          <div className="children-grid">
            {children.map((child) => (
              <div key={child.id} className="child-card" onClick={() => router.push(`/dashboard/child/${child.id}`)}>
                <div className="child-avatar">{child.name.charAt(0)}</div>
                <div className="child-name">{child.name}</div>
                <div className="child-grade">{t('grade')} {child.grade}</div>
                <div className="child-meta">{t('username')}: <span>{child.username}</span></div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
