// A 204 No Content response. Elysia serializes returned values, so deletes return
// this explicit empty response instead of a body.
export const noContent = () => new Response(null, { status: 204 });

// Whether a request to an /internal/* route carries the worker's shared secret
// (x-worker-token = WORKER_INTERNAL_TOKEN). False when the token is not configured.
export function workerTokenValid(headers: Record<string, string | undefined>): boolean {
  const expected = process.env.WORKER_INTERNAL_TOKEN;
  return !!expected && headers['x-worker-token'] === expected;
}
