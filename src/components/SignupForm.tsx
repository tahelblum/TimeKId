'use client';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';

export default function SignupForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) { setError('הסיסמאות אינן תואמות'); return; }
    if (password.length < 6) { setError('הסיסמה חייבת להכיל לפחות 6 תווים'); return; }
    setLoading(true);
    try {
      await signup(name, email, password);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'ההרשמה נכשלה');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-blob auth-blob-1" />
      <div className="auth-blob auth-blob-2" />
      <div className="auth-blob auth-blob-3" />
      <div className="auth-card">
        <div className="auth-icon">
          <UserPlus size={36} color="white" strokeWidth={2.5} />
        </div>
        <h1 className="auth-title">הרשמה</h1>
        <p className="auth-subtitle">צרו חשבון הורים חדש</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="error-box">{error}</div>}
          <div className="form-field">
            <label>שם מלא</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="שם מלא" />
          </div>
          <div className="form-field">
            <label>אימייל</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="your@email.com" />
          </div>
          <div className="form-field">
            <label>סיסמה</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          <div className="form-field">
            <label>אימות סיסמה</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'נרשם...' : 'הירשם'}
          </button>
        </form>
        <p className="auth-footer">
          כבר יש לכם חשבון?{' '}
          <a href="/">התחברו כאן</a>
        </p>
      </div>
    </div>
  );
}

  return (
    <div className="auth-page">
      <div className="auth-blob auth-blob-1" />
      <div className="auth-blob auth-blob-2" />
      <div className="auth-blob auth-blob-3" />

      <div className="auth-card">
        <div className="auth-icon">
          <UserPlus size={36} color="white" strokeWidth={2.5} />
        </div>
        <h1 className="auth-title">{t('title')}</h1>
        <p className="auth-subtitle">{t('subtitle')}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="error-box">{error}</div>}
          <div className="form-field">
            <label>{t('name')}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder={t('namePlaceholder')} />
          </div>
          <div className="form-field">
            <label>{t('email')}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="your@email.com" />
          </div>
          <div className="form-field">
            <label>{t('password')}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          <div className="form-field">
            <label>{t('confirmPassword')}</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? t('loading') : t('submit')}
          </button>
        </form>

        <p className="auth-footer">
          {t('hasAccount')}{' '}
          <a href="/">{t('loginLink')}</a>
        </p>
      </div>
    </div>
  );
}
