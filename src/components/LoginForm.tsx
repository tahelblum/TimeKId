'use client';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogIn } from 'lucide-react';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();
  const t = useTranslations('login');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || t('failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-blob auth-blob-1" />
      <div className="auth-blob auth-blob-2" />
      <div className="auth-blob auth-blob-3" />

      <div className="stars-bg">
        {['⭐','🌟','✨','💫','⭐','🌟','✨'].map((s, i) => (
          <span key={i} className="star" style={{
            top: `${10 + i * 12}%`,
            left: `${5 + i * 13}%`,
            animationDelay: `${i * 0.4}s`,
            fontSize: `${1 + (i % 3) * 0.4}rem`
          }}>{s}</span>
        ))}
      </div>

      <div className="auth-card">
        <div className="auth-icon">
          <LogIn size={36} color="white" strokeWidth={2.5} />
        </div>
        <h1 className="auth-title">{t('welcome')}</h1>
        <p className="auth-subtitle">{t('subtitle')}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="error-box">{error}</div>}
          <div className="form-field">
            <label>{t('email')}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="your@email.com" />
          </div>
          <div className="form-field">
            <label>{t('password')}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? t('loading') : t('submit')}
          </button>
        </form>

        <p className="auth-footer">
          {t('noAccount')}{' '}
          <a href="/signup">{t('signupLink')}</a>
        </p>
      </div>
    </div>
  );
}
