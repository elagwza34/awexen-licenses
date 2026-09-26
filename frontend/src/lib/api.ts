/**
 * Typed API client.
 *
 * Token strategy:
 *  - The access token lives in memory only (never localStorage, so XSS cannot
 *    read it from persistent storage).
 *  - The refresh token lives in an httpOnly cookie set by the API, so page
 *    JavaScript can never read it either.
 *  - A 401 triggers exactly one refresh attempt; concurrent 401s queue behind
 *    the same promise instead of stampeding the refresh endpoint.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export interface ApiErrorShape {
  code: string;
  message: string | string[];
  details?: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string | string[],
    public details?: unknown,
    public requestId?: string,
  ) {
    // class-validator returns string[] for multi-error payloads.
    super(Array.isArray(message) ? message.join(' • ') : message);
    this.name = 'ApiError';
    this.rawMessage = message;
  }

  readonly rawMessage: string | string[];

  /** Single readable line, joining validation errors. */
  get friendlyMessage(): string {
    return this.message;
  }
}

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  // Collapse parallel refreshes into a single in-flight request.
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch(`${BASE_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) return false;
        const data = await response.json();
        accessToken = data.tokens.accessToken;
        return true;
      } catch {
        return false;
      } finally {
        // Allow a later 401 to attempt a fresh refresh.
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      }
    })();
  }
  return refreshPromise;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Internal: prevents an infinite refresh loop. */
  _retried?: boolean;
  params?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, params?: RequestOptions['params']): string {
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!params) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, _retried, params, headers, ...rest } = options;

  const response = await fetch(buildUrl(path, params), {
    ...rest,
    // The refresh cookie must travel with every request.
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 401 && !_retried) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, _retried: true });
    }
    accessToken = null;
    onUnauthorized?.();
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const error = (payload?.error ?? {}) as ApiErrorShape;
    throw new ApiError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.message ?? `Request failed with status ${response.status}`,
      error.details,
      error.requestId,
    );
  }

  return payload as T;
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string, params?: RequestOptions['params']) =>
    apiRequest<T>(path, { method: 'GET', params }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'DELETE', body }),
};
