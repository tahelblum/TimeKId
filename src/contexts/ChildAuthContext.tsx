'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { API_URL, API_ENDPOINTS } from '@/lib/api';

interface Child {
  id: number;
  name: string;
  username: string;
  grade: string;
}

interface ChildAuthContextType {
  child: Child | null;
  authToken: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const ChildAuthContext = createContext<ChildAuthContextType | undefined>(undefined);

export function ChildAuthProvider({ children }: { children: React.ReactNode }) {
  const [child, setChild] = useState<Child | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('childAuthToken');
    const savedChild = localStorage.getItem('childData');
    if (savedToken && savedChild) {
      setAuthToken(savedToken);
      setChild(JSON.parse(savedChild));
    }
    setLoading(false);
  }, []);

  const login = async (username: string, password: string) => {
    const response = await fetch(`${API_URL}${API_ENDPOINTS.CHILD_AUTH.LOGIN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Login failed');
    }
    const data = await response.json();
    setAuthToken(data.authToken);
    setChild(data.child);
    localStorage.setItem('childAuthToken', data.authToken);
    localStorage.setItem('childData', JSON.stringify(data.child));
  };

  const logout = () => {
    setChild(null);
    setAuthToken(null);
    localStorage.removeItem('childAuthToken');
    localStorage.removeItem('childData');
  };

  return (
    <ChildAuthContext.Provider value={{ child, authToken, login, logout, loading }}>
      {children}
    </ChildAuthContext.Provider>
  );
}

export function useChildAuth() {
  const context = useContext(ChildAuthContext);
  if (!context) throw new Error('useChildAuth must be used within ChildAuthProvider');
  return context;
}
