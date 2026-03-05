'use client';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { LogIn } from 'lucide-react';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const router = useRouter();
  const t = useTranslations('login');
  const locale = useLocale();
  const isRTL = locale === 'he';

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
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka+One&family=Nunito:wght@400;600;700;800&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          font-family: 'Nunito', sans-serif;
          background: #FFF8F0;
          position: relative;
          overflow: hidden;
        }

        .bg-blob {
          position: fixed;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.35;
          pointer-events: none;
          z-index: 0;
        }
        .blob1 { width: 500px; height: 500px; background: #FFD6E0; top: -100px; left: -150px; }
        .blob2 { width: 400px; height: 400px; background: #C8F0FF; bottom: -80px; right: -100px; }
        .blob3 { width: 300px; height: 300px; background: #D4F7C5; top: 40%; left: 60%; }

        .card {
          position: relative;
          z-index: 1;
          background: white;
          border-radius: 32px;
          padding: 48px 40px;
          width: 100%;
          max-width: 440px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04);
          border: 2px solid rgba(255,255,255,0.9);
          direction: ${isRTL ? 'rtl' : 'ltr'};
          text-align: ${isRTL ? 'right' : 'left'};
          animation: slideUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(40px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .icon-wrap {
          width: 80px;
          height: 80px;
          background: linear-gradient(135deg, #FF6B9D, #FF8E53);
          border-radius: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          box-shadow: 0 8px 24px rgba(255, 107, 157, 0.35);
          animation: bounce 2s ease-in-out infinite;
        }

        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }

        .title {
          font-family: 'Fredoka One', cursive;
          font-size: 2.2rem;
          color: #2D2D2D;
          text-align: center;
          letter-spacing: 0.5px;
        }

        .subtitle {
          color: #888;
          text-align: center;
          margin-top: 8px;
          font-size: 1rem;
          font-weight: 600;
        }

        .form { margin-top: 32px; display: flex; flex-direction: column; gap: 20px; }

        .field label {
          display: block;
          font-weight: 700;
          font-size: 0.9rem;
          color: #555;
          margin-bottom: 8px;
          letter-spacing: 0.3px;
        }

        .field input {
          width: 100%;
          padding: 14px 18px;
          border: 2.5px solid #F0F0F0;
          border-radius: 16px;
          font-size: 1rem;
          font-family: 'Nunito', sans-serif;
          font-weight: 600;
          color: #333;
          background: #FAFAFA;
          transition: all 0.2s;
          outline: none;
          text-align: ${isRTL ? 'right' : 'left'};
        }

        .field input:focus {
          border-color: #FF6B9D;
          background: white;
          box-shadow: 0 0 0 4px rgba(255, 107, 157, 0.12);
          transform: scale(1.01);
        }

        .error-box {
          background: #FFF0F0;
          border: 2px solid #FFD0D0;
          color: #D63031;
          padding: 12px 16px;
          border-radius: 12px;
          font-size: 0.9rem;
          font-weight: 600;
        }

        .submit-btn {
          width: 100%;
          padding: 16px;
          background: linear-gradient(135deg, #FF6B9D, #FF8E53);
          color: white;
          border: none;
          border-radius: 18px;
          font-size: 1.1rem;
          font-family: 'Fredoka One', cursive;
          letter-spacing: 1px;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 6px 20px rgba(255, 107, 157, 0.4);
          margin-top: 4px;
        }

        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 10px 28px rgba(255, 107, 157, 0.5);
        }

        .submit-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .footer-text {
          text-align: center;
          color: #999;
          font-size: 0.9rem;
          font-weight: 600;
          margin-top: 24px;
        }

        .footer-text a {
          color: #FF6B9D;
          text-decoration: none;
          font-weight: 800;
          transition: color 0.2s;
        }

        .footer-text a:hover { color: #FF8E53; }

        .stars {
          position: fixed;
          pointer-events: none;
          z-index: 0;
          width: 100%;
          height: 100%;
          top: 0; left: 0;
        }

        .star {
          position: absolute;
          font-size: 1.5rem;
          animation: twinkle 3s ease-in-out infinite;
          opacity: 0.4;
        }

        @keyframes twinkle {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.2); }
        }
      `}</style>

      <div className="login-page">
        <div className="bg-blob blob1" />
        <div className="bg-blob blob2" />
        <div className="bg-blob blob3" />

        <div className="stars">
          {['⭐','🌟','✨','💫','⭐','🌟','✨'].map((s, i) => (
            <span key={i} className="star" style={{
              top: `${10 + i * 12}%`,
              left: `${5 + i * 13}%`,
              animationDelay: `${i * 0.4}s`,
              fontSize: `${1 + (i % 3) * 0.5}rem`
            }}>{s}</span>
          ))}
        </div>

        <div className="card">
          <div className="icon-wrap">
            <LogIn size={36} color="white" strokeWidth={2.5} />
          </div>

          <h1 className="title">{t('welcome')}</h1>
          <p className="subtitle">{t('subtitle')}</p>

          <form className="form" onSubmit={handleSubmit}>
            {error && <div className="error-box">{error}</div>}

            <div className="field">
              <label>{t('email')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="your@email.com"
                dir="ltr"
              />
            </div>

            <div className="field">
              <label>{t('password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                dir="ltr"
              />
            </div>

            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? t('loading') : t('submit')}
            </button>
          </form>

          <p className="footer-text">
            {t('noAccount')}{' '}
            <a href="/signup">{t('signupLink')}</a>
          </p>
        </div>
      </div>
    </>
  );
}
