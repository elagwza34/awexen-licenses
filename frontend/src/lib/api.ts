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

  /**
   * A message safe to show a user.
   *
   * The server's own text is used whenever it was written for a human, but the
   * framework also emits routing and internal errors whose text is technical,
   * such as "Cannot POST /api/v1/portal/register". Showing that to a customer
   * tells them nothing and makes the product look broken, so those are replaced
   * with something that says what actually happened.
   */
  get friendlyMessage(): string {
    const text = this.message;

    if (this.status === 404) {
      return 'الخدمة المطلوبة غير متاحة حالياً. يرجى المحاولة بعد قليل.';
    }
    if (this.status >= 500) {
      return 'حدث خطأ في الخادم. يرجى المحاولة بعد قليل.';
    }

    // NestJS reports an unrouted path by echoing the method and the path into
    // the message. A string containing either is never copy written for a human.
    if (/\b(GET|POST|PUT|PATCH|DELETE)\b|\/api\//i.test(text)) {
      return 'تعذّر إتمام الطلب. يرجى المحاولة مرة أخرى.';
    }
    return text;
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

  // FormData must be handed to fetch untouched: it sets its own multipart
  // boundary, and a Content-Type of application/json here would produce a body
  // the server cannot parse at all.
  const isFormData = body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), {
      ...rest,
      // The refresh cookie must travel with every request.
      credentials: 'include',
      headers: {
        ...(body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      ...(body !== undefined
        ? { body: isFormData ? (body as FormData) : JSON.stringify(body) }
        : {}),
    });
  } catch {
    // A DNS failure, a refused connection or a CORS rejection rejects before
    // any status line exists, so there is nothing to read. Without this the
    // raw browser text ("Failed to fetch", "Cannot POST /api/v1/...") reaches
    // the user, which says nothing about what went wrong.
    throw new ApiError(0, 'NETWORK_ERROR', 'تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.');
  }

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

/**
 * Fetches a binary body.
 *
 * Separate from `apiRequest` because that one always parses the response as
 * JSON — on an image route that silently yields `null` and loses the picture.
 * Errors are still raised as `ApiError` so callers can treat both paths alike.
 */
async function apiBlob(path: string, headers?: Record<string, string>): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      method: 'GET',
      credentials: 'include',
      headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.');
  }

  if (!response.ok) {
    // The error route answers JSON even though the success route does not.
    const payload = safeJsonParse(await response.text());
    const error = (payload?.error ?? {}) as ApiErrorShape;
    throw new ApiError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.message ?? `Request failed with status ${response.status}`,
      error.details,
      error.requestId,
    );
  }

  return response.blob();
}

export const api = {
  getBlob: (path: string, headers?: Record<string, string>) => apiBlob(path, headers),
  get: <T>(path: string, params?: RequestOptions['params'], headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'GET', params, headers }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'POST', body, headers }),
  put: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'PUT', body, headers }),
  patch: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'PATCH', body, headers }),
  delete: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'DELETE', body, headers }),
  /**
   * Multipart upload. The Content-Type header is deliberately omitted so the
   * browser can add the multipart boundary itself.
   */
  postForm: <T>(path: string, body: FormData, headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'POST', body, headers }),
};
