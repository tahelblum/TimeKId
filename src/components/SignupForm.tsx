'use client';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
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
  const t = useTranslations('signup');
  const locale = useLocale();
  const isRTL = locale === 'he';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('passwordMismatch'));
      return;
    }
    if (password.length < 6) {
      setError(t('passwordTooShort'));
      return;
    }

    setLoading(true);
    try {
      await signup(name, email, password);
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

        .signup-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          font-family: 'Nunito', sans-serif;
          background: #F0F8FF;
          position: relative;
          overflow: hidden;
        }

        .bg-blob { position: fixed; border-radius: 50%; filter: blur(80px); opacity: 0.35; pointer-events: none; z-index: 0; }
        .blob1 { width: 500px; height: 500px; background: #C8F0FF; top: -100px; right: -150px; }
        .blob2 { width: 400px; height: 400px; background: #D4F7C5; bottom: -80px; left: -100px; }
        .blob3 { width: 300px; height: 300px; background: #FFD6E0; top: 30%; right: 60%; }

        .card {
          position: relative;
          z-index: 1;
          background: white;
          border-radius: 32px;
          padding: 44px 40px;
          width: 100%;
          max-width: 440px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04);
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
          background: linear-gradient(135deg, #4FC3F7, #29B6F6);
          border-radius: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          box-shadow: 0 8px 24px rgba(79, 195, 247, 0.4);
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
        }

        .subtitle {
          color: #888;
          text-align: center;
          margin-top: 8px;
          font-size: 1rem;
          font-weight: 600;
        }

        .form { margin-top: 28px; display: flex; flex-direction: column; gap: 16px; }

        .field label {
          display: block;
          font-weight: 700;
          font-size: 0.9rem;
          color: #555;
          margin-bottom: 8px;
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
          border-color: #4FC3F7;
          background: white;
          box-shadow: 0 0 0 4px rgba(79, 195, 247, 0.15);
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
          background: linear-gradient(135deg, #4FC3F7, #0288D1);
          color: white;
          border: none;
          border-radius: 18px;
          font-size: 1.1rem;
          font-family: 'Fredoka One', cursive;
          letter-spacing: 1px;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 6px 20px rgba(79, 195, 247, 0.4);
          margin-top: 4px;
        }

        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 10px 28px rgba(79, 195, 247, 0.5);
        }

        .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .footer-text {
          text-align: center;
          color: #999;
          font-size: 0.9rem;
          font-weight: 600;
          margin-top: 20px;
        }

        .footer-text a {
          color: #0288D1;
          text-decoration: none;
          font-weight: 800;
        }

        .footer-text a:hover { color: #4FC3F7; }
      `}</style>

      <div className="signup-page">
        <div className="bg-blob blob1" />
        <div className="bg-blob blob2" />
        <div className="bg-blob blob3" />

        <div className="card">
          <div className="icon-wrap">
            <UserPlus size={36} color="white" strokeWidth={2.5} />
          </div>

          <h1 className="title">{t('title')}</h1>
          <p className="subtitle">{t('subtitle')}</p>

          <form className="form" onSubmit={handleSubmit}>
            {error && <div className="error-box">{error}</div>}

            <div className="field">
              <label>{t('name')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder={t('namePlaceholder')}
              />
            </div>

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

            <div className="field">
              <label>{t('confirmPassword')}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
            {t('hasAccount')}{' '}
            <a href="/">{t('loginLink')}</a>
          </p>
        </div>
      </div>
    </>
  );
}
