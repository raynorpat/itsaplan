// In-memory fixed-window rate limits for the portal routes. Counts are per API process
// and start over when it restarts; with several API processes each counts its own
// requests, which is enough to slow down abuse of the sign-in mail and the visitor
// writes.

const windows = new Map<string, { start: number; count: number }>();

export const LIMITS = {
  linksPerAddress: { limit: 5, windowMs: 60 * 60_000 },
  linksPerIp: { limit: 20, windowMs: 60 * 60_000 },
  votes: { limit: 60, windowMs: 60 * 60_000 },
  comments: { limit: 30, windowMs: 60 * 60_000 },
  suggestions: { limit: 10, windowMs: 60 * 60_000 },
  formSubmissions: { limit: 20, windowMs: 60 * 60_000 },
} as const;

// Counts one request for `key`; false once `limit` requests fell in the current window.
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || now - current.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 50_000) prune(now);
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

// Drops windows older than an hour, so the map does not grow without bound.
function prune(now: number): void {
  for (const [key, w] of windows) if (now - w.start >= 60 * 60_000) windows.delete(key);
}
