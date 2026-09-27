import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { usePortalSession } from '@/hooks/use-portal';

/**
 * Gate for the customer portal.
 *
 * Deliberately separate from the admin guard: it checks the customer token and
 * sends an unauthenticated visitor to the portal sign-in, never to the owner's
 * login. A customer who lands on the wrong screen cannot tell the difference
 * between "not signed in" and "signed in to the wrong place", and a redirect to
 * /login would be a confusing dead end.
 *
 * `state.from` is preserved so signing in returns the customer to the page they
 * actually wanted, rather than always dropping them on the overview.
 */
export function PortalRoute() {
  const { signedIn } = usePortalSession();
  const location = useLocation();

  if (!signedIn) {
    return <Navigate to="/portal/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
