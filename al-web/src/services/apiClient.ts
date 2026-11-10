import { firebaseAuthService, type AuthService } from './authService';

export type ApiErrorKind = 'http' | 'network' | 'auth' | 'response';

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface JsonRequest {
  method: 'GET' | 'POST';
  body?: unknown;
}

export interface ApiClient {
  request<T>(path: string, request: JsonRequest): Promise<T>;
}

interface ApiClientOptions {
  authService?: Pick<AuthService, 'getCurrentIdToken'>;
  fetcher?: typeof fetch;
  baseUrl?: string;
}

function errorDetail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('detail' in body)) {
    return null;
  }

  const detail = body.detail;
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }

  const first = Array.isArray(detail) ? detail[0] : null;
  return typeof first?.msg === 'string' && first.msg.trim() ? first.msg : null;
}

const LOCAL_GATEWAY = 'http://localhost:8000';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// The gateway the portal calls. A development build falls back to the local gateway; a production
// build must be given VITE_API_BASE_URL and refuses a localhost one, so the hosted site can never
// call a laptop. Same fail-fast rule as the Firebase settings in firebase.ts.
export function apiBaseUrl(configured: string | undefined, development: boolean): string {
  const value = configured?.trim();
  if (!value) {
    if (development) {
      return LOCAL_GATEWAY;
    }
    throw new Error('Missing required API configuration: VITE_API_BASE_URL');
  }

  if (!development) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('VITE_API_BASE_URL must be an absolute https:// URL');
    }
    if (url.protocol !== 'https:' || LOCAL_HOSTS.has(url.hostname)) {
      throw new Error('VITE_API_BASE_URL must be an https:// URL that is not localhost in a production build');
    }
  }

  return value;
}

// Auth and transport are injected at the boundary; no retries or token persistence.
export function createApiClient({
  authService = firebaseAuthService,
  fetcher = fetch,
  baseUrl = apiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV),
}: ApiClientOptions = {}): ApiClient {
  return {
    async request<T>(path: string, { method, body }: JsonRequest): Promise<T> {
      let token: string;
      try {
        token = await authService.getCurrentIdToken();
      } catch (error) {
        const network = typeof error === 'object' && error !== null &&
          'code' in error && error.code === 'auth/network-request-failed';
        throw new ApiError(network ? 'network' : 'auth', network
          ? 'Could not reach the server. Check your connection and try again.'
          : 'Could not authenticate this request. Sign in again.');
      }

      let response: Response;
      try {
        response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        throw new ApiError('network', 'Could not reach the server. Check your connection and try again.');
      }

      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new ApiError('http', errorDetail(data) ?? 'The request failed. Please try again.', response.status);
      }
      if (data === null) {
        throw new ApiError('response', 'The server returned an unreadable response. Reload to see the current status.');
      }
      return data as T;
    },
  };
}
