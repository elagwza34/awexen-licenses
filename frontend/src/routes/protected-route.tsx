import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadingState } from '@/components/state';
import { useAuth } from '@/hooks/use-auth';

/**
 * Client-side route guard. It is a UX affordance only — every endpoint the
 * panel calls is independently authorised on the server.
 */
export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="جارٍ التحقق من الجلسة…" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Remember where they were headed so login can return them there.
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <Outlet />;
}
