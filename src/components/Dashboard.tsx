'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
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
  const locale = useLocale();
  const isRTL = locale === 'he';

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  if (loading || !user) {
    return (
      <>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Fredoka+One&family=Nunito:wght@700&display=swap');
          .loading-screen {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #FFF8F0;
            font-family: 'Fredoka One', cursive;
            font-size: 1.8rem;
            color: #FF6B9D;
          }
          .spinner {
            width: 48px; height: 48px;
            border: 5px solid #FFD6E0;
            border-top-color: #FF6B9D;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-left: 16px;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
        <div className="loading-screen">
          <div className="spinner" />
          {t('loading')}
        </div>
      </>
    );
  }

  const colors = [
    { bg: '#FFD6E0', text: '#FF6B9D', shadow: 'rgba(255,107,157,0.3)' },
    { bg: '#C8F0FF', text: '#0288D1', shadow: 'rgba(2,136,209,0.3)' },
    { bg: '#D4F7C5', text: '#2E7D32', shadow: 'rgba(46,125,50,0.3)' },
    { bg: '#FFF3C4', text: '#F59E0B', shadow: 'rgba(245,158,11,0.3)' },
    { bg: '#E8D5FF', text: '#7C3AED', shadow: 'rgba(124,58,237,0.3)' },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka+One&family=Nunito:wght@400;600;700;800&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        .dashboard {
          min-height: 100vh;
          background: #FFF8F0;
          font-family: 'Nunito', sans-serif;
          direction: ${isRTL ? 'rtl' : 'ltr'};
        }

        .header {
          background: white;
          border-bottom: 3px solid #FFE4EC;
          padding: 20px 32px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          position: sticky;
          top: 0;
          z-index: 10;
          box-shadow: 0 4px 20px rgba(255,107,157,0.1);
        }

        .header-logo {
          font-family: 'Fredoka One', cursive;
          font-size: 1.8rem;
          background: linear-gradient(135deg, #FF6B9D, #FF8E53);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .header-user { text-align: ${isRTL ? 'right' : 'left'}; }
        .header-name { font-weight: 800; font-size: 1.1rem; color: #2D2D2D; }
        .header-email { font-size: 0.85rem; color: #999; font-weight: 600; }

        .logout-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          border: 2.5px solid #FFE4EC;
          border-radius: 14px;
          background: white;
          color: #FF6B9D;
          font-family: 'Nunito', sans-serif;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .logout-btn:hover {
          background: #FFF0F5;
          border-color: #FF6B9D;
          transform: translateY(-1px);
        }

        .main { max-width: 1100px; margin: 0 auto; padding: 40px 32px; }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 36px;
          flex-wrap: wrap;
          gap: 16px;
        }

        .page-title {
          font-family: 'Fredoka One', cursive;
          font-size: 2.4rem;
          color: #2D2D2D;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .page-subtitle {
          color: #999;
          font-weight: 600;
          margin-top: 6px;
          font-size: 1rem;
        }

        .add-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 28px;
          background: linear-gradient(135deg, #FF6B9D, #FF8E53);
          color: white;
          border: none;
          border-radius: 18px;
          font-family: 'Fredoka One', cursive;
          font-size: 1.1rem;
          letter-spacing: 0.5px;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 6px 20px rgba(255,107,157,0.4);
        }

        .add-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 28px rgba(255,107,157,0.5);
        }

        .empty-state {
          background: white;
          border-radius: 28px;
          padding: 80px 40px;
          text-align: center;
          border: 3px dashed #FFE4EC;
          animation: fadeIn 0.5s ease;
        }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

        .empty-icon {
          width: 100px;
          height: 100px;
          background: linear-gradient(135deg, #FFE4EC, #FFD6E0);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 24px;
        }

        .empty-title {
          font-family: 'Fredoka One', cursive;
          font-size: 1.8rem;
          color: #2D2D2D;
          margin-bottom: 12px;
        }

        .empty-sub { color: #999; font-weight: 600; margin-bottom: 32px; font-size: 1.05rem; }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 24px;
        }

        .child-card {
          background: white;
          border-radius: 24px;
          padding: 28px;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
          border: 2.5px solid #F5F5F5;
          animation: fadeIn 0.4s ease;
        }

        .child-card:hover {
          transform: translateY(-6px) scale(1.02);
          box-shadow: 0 16px 40px rgba(0,0,0,0.1);
          border-color: transparent;
        }

        .child-avatar {
          width: 64px;
          height: 64px;
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Fredoka One', cursive;
          font-size: 2rem;
          margin-bottom: 16px;
        }

        .child-name {
          font-family: 'Fredoka One', cursive;
          font-size: 1.4rem;
          color: #2D2D2D;
        }

        .child-grade {
          font-size: 0.9rem;
          color: #999;
          font-weight: 600;
          margin-top: 4px;
        }

        .child-meta {
          margin-top: 16px;
          padding-top: 16px;
          border-top: 2px solid #F5F5F5;
          font-size: 0.875rem;
          color: #777;
          font-weight: 600;
        }

        .child-meta span { font-weight: 800; color: #444; }
      `}</style>

      <div className="dashboard">
        <header className="header">
          <div className="header-logo">⏰ TimeKid</div>
          <div className="header-user">
            <div className="header-name">{t('hello')}, {user.name} 👋</div>
            <div className="header-email">{user.email}</div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={18} />
            {t('logout')}
          </button>
        </header>

        <main className="main">
          <div className="page-header">
            <div>
              <h2 className="page-title">
                <Users size={36} />
                {t('myChildren')}
              </h2>
              <p className="page-subtitle">{t('subtitle')}</p>
            </div>
            <button className="add-btn" onClick={() => router.push('/dashboard/create-child')}>
              <UserPlus size={22} />
              {t('addChild')}
            </button>
          </div>

          {children.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <Users size={48} color="#FF6B9D" />
              </div>
              <h3 className="empty-title">{t('noChildren')}</h3>
              <p className="empty-sub">{t('noChildrenSubtitle')}</p>
              <button className="add-btn" style={{margin: '0 auto', display: 'flex'}} onClick={() => router.push('/dashboard/create-child')}>
                <UserPlus size={22} />
                {t('addChild')}
              </button>
            </div>
          ) : (
            <div className="grid">
              {children.map((child, i) => {
                const color = colors[i % colors.length];
                return (
                  <div
                    key={child.id}
                    className="child-card"
                    onClick={() => router.push(`/dashboard/child/${child.id}`)}
                    style={{ boxShadow: `0 4px 20px ${color.shadow}` }}
                  >
                    <div className="child-avatar" style={{ background: color.bg }}>
                      <span style={{ color: color.text }}>{child.name.charAt(0)}</span>
                    </div>
                    <div className="child-name">{child.name}</div>
                    <div className="child-grade">{t('grade')} {child.grade}</div>
                    <div className="child-meta">
                      {t('username')}: <span>{child.username}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
