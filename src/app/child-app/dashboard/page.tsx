'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useChildAuth } from '@/contexts/ChildAuthContext';
import KidDashboard from '@/components/KidDashboard';

export default function ChildDashboardPage() {
  const { child, loading } = useChildAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !child) router.push('/child-app');
  }, [child, loading, router]);

  if (loading || !child) {
    return <div className="loading-screen"><div className="spinner" /></div>;
  }

  return <KidDashboard />;
}
