import { ChildAuthProvider } from '@/contexts/ChildAuthContext';

export default function ChildAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChildAuthProvider>
      {children}
    </ChildAuthProvider>
  );
}
