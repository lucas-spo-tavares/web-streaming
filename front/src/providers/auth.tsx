import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { auth } from '@/services/auth';

interface AuthContextValue {
  session: ReturnType<typeof auth.snapshot>;
  error: string;
  logout: () => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(auth.subscribe, auth.snapshot);
  const queryClient = useQueryClient();
  useEffect(() => {
    window.addEventListener('storage', auth.syncStorage);

    return () => window.removeEventListener('storage', auth.syncStorage);
  }, []);

  useEffect(() => {
    if (!session) {
      queryClient.clear();

      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const checkExpiry = () => {
      if (session.expires > Date.now()) return;
      void auth.token().catch(() => {
        if (!cancelled) timer = setTimeout(checkExpiry, 30000);
      });
    };
    timer = setTimeout(checkExpiry, Math.max(0, session.expires - Date.now()));

    window.addEventListener('focus', checkExpiry);
    document.addEventListener('visibilitychange', checkExpiry);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('focus', checkExpiry);
      document.removeEventListener('visibilitychange', checkExpiry);
    };
  }, [session, queryClient]);

  function logout() {
    auth.logout();
    queryClient.clear();
  }

  return (
    <AuthContext.Provider value={{ session, error: auth.error, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) throw new Error('useAuth precisa de AuthProvider.');

  return context;
}
