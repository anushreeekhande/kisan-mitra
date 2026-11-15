const TOKEN_KEY = 'km_auth_token';
const ADMIN_TOKEN_KEY = 'km_admin_token';

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string | null) {
  if (token) {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  }
}

async function requestWithToken<T>(
  url: string,
  token: string | null,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  return requestWithToken<T>(url, getAuthToken(), options);
}

export async function adminApiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  return requestWithToken<T>(url, getAdminToken(), options);
}
