import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import type { AuthAdmin } from '@/types';

interface AuthContextValue {
  admin: AuthAdmin | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Frontend-side helper for hiding actions. The backend still enforces. */
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AuthAdmin | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On boot, try to restore the session from the refresh cookie.
  const loadSession = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        setAccessToken(data.tokens.accessToken);
        setAdmin(data.admin);
        return true;
      }
    } catch {
      // Network failure simply means "not signed in".
    }
    setAccessToken(null);
    setAdmin(null);
    return false;
  }, []);

  // Restore the session once, on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadSession();
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  // Any 401 that survives a refresh attempt means the session is really gone.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAccessToken(null);
      setAdmin(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string, totpCode?: string) => {
    const data = await api.post<{ admin: AuthAdmin; tokens: { accessToken: string } }>(
      '/auth/login',
      { email, password, totpCode },
    );
    setAccessToken(data.tokens.accessToken);
    setAdmin(data.admin);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      setAdmin(null);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!admin) return;
    const profile = await api.get<AuthAdmin>('/auth/me');
    setAdmin(profile);
  }, [admin]);

  const can = useCallback(
    (permission: string) => {
      if (!admin) return false;
      // Super admin bypasses the UI checks, exactly like the backend guard.
      if (admin.roles.includes('SUPER_ADMIN')) return true;
      return admin.permissions.includes(permission);
    },
    [admin],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      admin,
      isLoading,
      isAuthenticated: Boolean(admin),
      login,
      logout,
      refreshProfile,
      can,
    }),
    [admin, isLoading, login, logout, refreshProfile, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

export { ApiError };
