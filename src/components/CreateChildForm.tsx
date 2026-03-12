'use client';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { UserPlus, ArrowRight } from 'lucide-react';
import { API_URL, API_ENDPOINTS } from '@/lib/api';

const GRADES = ['א','ב','ג','ד','ה','ו','ז','ח','ט','י','יא','יב'];

export default function CreateChildForm() {
  const { authToken } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [grade, setGrade] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}${API_ENDPOINTS.CHILDREN.CREATE}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ name, username, password, grade }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'שגיאה ביצירת הילד');
      }
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-page">
      <div className="form-page-header">
        <button className="btn-back" onClick={() => router.back()}>
          <ArrowRight size={20} />
          חזרה
        </button>
      </div>
      <div className="form-card">
        <div className="auth-icon">
          <UserPlus size={36} color="white" strokeWidth={2.5} />
        </div>
        <h1 className="auth-title">הוסף ילד</h1>
        <p className="auth-subtitle">הזינו את פרטי הילד</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="error-box">{error}</div>}
          <div className="form-field">
            <label>שם הילד</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder="שם מלא"
            />
          </div>
          <div className="form-field">
            <label>שם משתמש</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              placeholder="username"
            />
          </div>
          <div className="form-field">
            <label>סיסמה</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="סיסמה לכניסת הילד"
              autoComplete="new-password"
            />
          </div>
          <div className="form-field">
            <label>כיתה</label>
            <select
              value={grade}
              onChange={e => setGrade(e.target.value)}
              required
              className="form-select"
            >
              <option value="">בחר כיתה</option>
              {GRADES.map(g => (
                <option key={g} value={g}>כיתה {g}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'יוצר...' : 'צור פרופיל ילד'}
          </button>
        </form>
      </div>
    </div>
  );
}
