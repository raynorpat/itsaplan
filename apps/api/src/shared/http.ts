// Whether a request to an /internal/* route carries the worker's shared secret
// (x-worker-token = WORKER_INTERNAL_TOKEN). False when the token is not configured.
export function workerTokenValid(headers: Record<string, string | undefined>): boolean {
  const expected = process.env.WORKER_INTERNAL_TOKEN;
  return !!expected && headers['x-worker-token'] === expected;
}
