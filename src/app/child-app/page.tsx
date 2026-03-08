'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useChildAuth } from '@/contexts/ChildAuthContext';
import { BookOpen } from 'lucide-react';

export default function ChildLoginPage() {
  const { login, loading, child } = useChildAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && child) router.push('/child-app/dashboard');
  }, [child, loading, router]);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await login(username.trim(), password);
      router.push('/child-app/dashboard');
    } catch {
      setError('שם משתמש או סיסמה שגויים. נסה שוב!');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-blob auth-blob-1" />
      <div className="auth-blob auth-blob-2" />
      <div className="auth-blob auth-blob-3" />
      <div className="auth-card" style={{ maxWidth: 380 }}>
        <div className="auth-icon" style={{ background: 'linear-gradient(135deg, #FFD93D, #FF6B6B)' }}>
          <BookOpen size={40} color="white" />
        </div>
        <h1 className="auth-title">שלום! 👋</h1>
        <p className="auth-subtitle">היכנס לאזור הלימוד שלך</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="error-box">{error}</div>}
          <div className="form-field">
            <label>שם משתמש</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="הזן שם משתמש..."
              autoComplete="username"
            />
          </div>
          <div className="form-field">
            <label>סיסמה</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="הזן סיסמה..."
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={submitting || !username.trim() || !password.trim()}
          >
            {submitting ? 'נכנס...' : 'כניסה 🚀'}
          </button>
        </form>
        <div className="auth-footer">
          <a href="/">כניסה להורים</a>
        </div>
      </div>
    </div>
  );
}
