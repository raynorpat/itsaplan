import { API_URL, ApiError } from '@/lib/graphql';

// The portal's own API routes (/portal/* on the API origin), used by the portal boards
// and the public forms. They accept only the portal session cookie, which the API sets
// on its own origin, so every request sends credentials.
export async function portalFetch<T>(
  path: string,
  init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: Record<string, unknown> },
): Promise<T> {
  const res = await fetch(`${API_URL}/portal${path}`, {
    method: init?.method ?? 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
  return data as T;
}
