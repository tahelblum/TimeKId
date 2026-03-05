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
  const { user, logout, authToken, loading } = useAuth();
  const router = useRouter();
  const [children, setChildren] = useState<Child[]>([]);

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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-600">טוען...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">שלום, {user.name}</h1>
              <p className="text-sm text-gray-600">{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
            >
              <LogOut className="w-5 h-5" />
              התנתק
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Users className="w-8 h-8 text-primary-600" />
              הילדים שלי
            </h2>
            <p className="text-gray-600 mt-2">נהלו את לוחות הזמנים והמשימות של הילדים שלכם</p>
          </div>
          <button
            onClick={() => router.push('/dashboard/create-child')}
            className="flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-6 py-3 rounded-lg font-medium transition"
          >
            <UserPlus className="w-5 h-5" />
            הוסף ילד
          </button>
        </div>

        {/* Children List */}
        {children.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4">
              <Users className="w-10 h-10 text-gray-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">אין ילדים רשומים</h3>
            <p className="text-gray-600 mb-6">התחילו על ידי הוספת הילד הראשון שלכם</p>
            <button
              onClick={() => router.push('/dashboard/create-child')}
              className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-6 py-3 rounded-lg font-medium transition"
            >
              <UserPlus className="w-5 h-5" />
              הוסף ילד
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {children.map((child) => (
              <div
                key={child.id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition cursor-pointer"
                onClick={() => router.push(`/dashboard/child/${child.id}`)}
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-2xl font-bold text-primary-600">
                      {child.name.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-gray-900">{child.name}</h3>
                    <p className="text-sm text-gray-600">כיתה {child.grade}</p>
                  </div>
                </div>
                <div className="text-sm text-gray-600">
                  <p>שם משתמש: <span className="font-medium">{child.username}</span></p>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
