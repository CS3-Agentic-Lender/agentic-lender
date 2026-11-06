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

// Auth and transport are injected at the boundary; no retries or token persistence.
export function createApiClient({
  authService = firebaseAuthService,
  fetcher = fetch,
  baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
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
