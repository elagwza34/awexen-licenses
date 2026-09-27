import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import {
  getPortalToken,
  portalApi,
  subscribeToPortalToken,
} from '@/lib/portal-api';

/**
 * The customer session, as a React subscription.
 *
 * The token is deliberately not in localStorage: it is held in a module-level
 * box, and this hook re-renders when that box changes. A reload therefore signs
 * the customer out, which is the right trade-off on a machine that may be
 * shared and never has to defend a token sitting in disk storage.
 */
export function usePortalSession() {
  const token = useSyncExternalStore(subscribeToPortalToken, getPortalToken, () => null);
  return { token, signedIn: Boolean(token) };
}

/**
 * The signed-in customer.
 *
 * Skipped entirely when there is no token, so signing out cannot leave a stale
 * name on screen, and the disabled query is never fired.
 */
export function usePortalCustomer() {
  const { token } = usePortalSession();
  return useQuery({
    queryKey: ['portal', 'me'],
    queryFn: portalApi.me,
    enabled: Boolean(token),
    staleTime: 60_000,
  });
}
