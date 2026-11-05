/**
 * Customer portal API client.
 *
 * A separate client from the admin one on purpose. The portal token is issued
 * with a different audience, and keeping its storage and calls in their own
 * module means an admin token can never be sent to a customer endpoint by a
 * shared helper, or the other way round.
 */
import { api, ApiError } from '@/lib/api';

const portalToken: { value: string | null } = { value: null };
const listeners = new Set<(token: string | null) => void>();

export function setPortalToken(token: string | null): void {
  portalToken.value = token;
  // Subscribers re-render the moment the session appears or disappears, which
  // is what lets the layout swap between the sign-in gate and the dashboard
  // without any component having to poll.
  for (const listener of listeners) listener(token);
}

export function getPortalToken(): string | null {
  return portalToken.value;
}

/** Subscribes to session changes. Returns the unsubscribe function. */
export function subscribeToPortalToken(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface PortalCustomer {
  id: number;
  email: string;
  name: string;
  company: string | null;
  phone: string | null;
  country: string | null;
  status: string;
  downloadEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PortalPlan {
  id: number;
  key: string;
  name: string;
  nameAr: string | null;
  price: number;
  currency: string;
  billingInterval: string;
  trialDays: number;
  maxDevices: number;
  description: string | null;
}

export interface PortalDevice {
  id: number;
  deviceName: string | null;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface PortalLicense {
  id: number;
  licenseKey: string;
  status: string;
  isTrial: boolean;
  startsAt: string;
  expiresAt: string | null;
  maxDevices: number;
  version: number;
  devices: PortalDevice[];
  lastValidationAt: string | null;
  plan: { key: string; name: string; nameAr: string | null };
}

export interface PortalRelease {
  version: string;
  buildNumber: number;
  fileSize: number | null;
  releasedAt: string;
  releaseNotes: string | null;
}

export interface PortalOverview {
  customer: PortalCustomer;
  licenses: PortalLicense[];
  latestRelease: PortalRelease | null;
  canDownload: boolean;
}

export interface PortalRequest {
  id: number;
  amount: number;
  currency: string;
  status: string;
  receiptUrl: string | null;
  transactionReference: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface SessionResponse {
  accessToken: string;
  customer: {
    id: number;
    email: string;
    name: string;
    company: string | null;
    downloadEnabled: boolean;
  };
}

export class PortalError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PortalError';
  }
}

/** Turns any thrown value into a message safe to show a customer. */
function toPortalError(error: unknown): PortalError {
  if (error instanceof PortalError) return error;
  if (error instanceof ApiError) return new PortalError(error.status, error.friendlyMessage);
  return new PortalError(0, 'تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.');
}

/**
 * Portal calls carry the customer token, not the admin one. A 401 clears it
 * rather than refreshing: the portal has no refresh cookie, so the honest
 * response is to send the customer back to sign-in.
 */
async function portalRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; isForm?: boolean } = {},
): Promise<T> {
  const headers = portalToken.value ? { Authorization: `Bearer ${portalToken.value}` } : undefined;

  try {
    const method = options.method ?? 'GET';
    if (options.isForm) {
      return await api.postForm<T>(path, options.body as FormData, headers);
    }
    if (method === 'POST') return await api.post<T>(path, options.body, headers);
    if (method === 'PATCH') return await api.patch<T>(path, options.body, headers);
    if (method === 'DELETE') return await api.delete<T>(path, options.body, headers);
    return await api.get<T>(path, undefined, headers);
  } catch (error) {
    const portalError = toPortalError(error);
    if (portalError.status === 401) setPortalToken(null);
    throw portalError;
  }
}

export const portalApi = {
  installer: () => portalRequest<{ release: { downloadUrl: string; version: string; checksum: string | null } }>('/portal/download'),
  register: (body: {
    name: string;
    email: string;
    password: string;
    company?: string;
    phone?: string;
    country?: string;
  }) => portalRequest<SessionResponse>('/portal/register', { method: 'POST', body }),
  login: (body: { email: string; password: string }) =>
    portalRequest<SessionResponse>('/portal/login', { method: 'POST', body }),

  me: () => portalRequest<PortalCustomer>('/portal/me'),

  overview: () => portalRequest<PortalOverview>('/portal/overview'),

  /**
   * The full keys.
   *
   * Kept apart from `overview`, which masks them: the dashboard should not park
   * every customer secret in page state just to draw a summary row.
   */
  licenseKeys: () =>
    portalRequest<{
      data: { id: number; licenseKey: string; status: string; expiresAt: string | null; plan: { name: string; nameAr: string | null } }[];
    }>('/portal/licenses'),

  catalogue: () => portalRequest<{ plans: PortalPlan[] }>('/portal/catalogue'),

  requests: () => portalRequest<{ data: PortalRequest[] }>('/portal/requests'),

  /**
   * Fetches one of the customer's own receipts.
   *
   * A plain link cannot work here: the route requires the customer token and an
   * `<a href>` carries no Authorization header, which is exactly why the naive
   * `receiptUrl` link 404'd. Returns the blob so the caller decides how to
   * present it.
   */
  receiptBlob: (paymentId: number) =>
    api.getBlob(`/portal/requests/${paymentId}/receipt`, {
      Authorization: `Bearer ${portalToken.value ?? ''}`,
    }),

  /**
   * Submits the receipt. The plan and amount travel as text fields because the
   * body is multipart; the server parses and validates them.
   */
  requestActivation: (body: { planId: number; amount: number; notes?: string; receipt: File }) => {
    const form = new FormData();
    form.append('planId', String(body.planId));
    form.append('amount', String(body.amount));
    if (body.notes) form.append('notes', body.notes);
    form.append('receipt', body.receipt);
    return portalRequest<{ id: number; status: string; message: string }>(
      '/portal/activation-request',
      { method: 'POST', body: form, isForm: true },
    );
  },
};
