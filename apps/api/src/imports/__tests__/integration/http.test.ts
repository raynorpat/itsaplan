import { afterAll, describe, expect, it } from 'bun:test';
import { getJson, sourceUrl, withRateLimitNotice } from '../../sources/http';

// The import sources' HTTP helper against a stub server: response size limits, rate
// limits (waited out up to a limit, then reported as such), and source URLs.

let limitedOnce = true;

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/huge')
      return new Response(new Uint8Array(21 * 1024 * 1024).fill(32), {
        headers: { 'content-type': 'application/json' },
      });
    if (url.pathname === '/huge-error')
      return new Response('x'.repeat(5 * 1024 * 1024), { status: 500 });
    if (url.pathname === '/limited-long')
      return new Response('limit', {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 2 * 3600),
        },
      });
    if (url.pathname === '/limited-once') {
      if (limitedOnce) {
        limitedOnce = false;
        return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } });
      }
      return Response.json({ ok: true });
    }
    return new Response('not found', { status: 404 });
  },
});
const base = `http://localhost:${server.port}`;

afterAll(() => server.stop(true));

describe('import source HTTP', () => {
  it('refuses a response body over the size limit', async () => {
    await expect(getJson(`${base}/huge`, {}, '')).rejects.toThrow(/too large/i);
  });

  it('keeps at most 200 characters of an error body', async () => {
    const err = (await getJson(`${base}/huge-error`, {}, '').catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/500/);
    expect(err.message.length).toBeLessThan(260);
  });

  it('reports a rate limit that resets too late as a rate limit', async () => {
    const started = Date.now();
    const err = (await getJson(`${base}/limited-long`, {}, '').catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/rate limit/i);
    expect(err.message).not.toMatch(/not allowed/i);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('tells the caller how long it waits for a rate limit', async () => {
    const waits: Date[] = [];
    const res = await withRateLimitNotice(
      (until) => {
        waits.push(until);
      },
      () => getJson<{ ok: boolean }>(`${base}/limited-once`, {}, ''),
    );
    expect(res.data).toEqual({ ok: true });
    expect(waits).toHaveLength(1);
    expect(waits[0]!.getTime()).toBeGreaterThan(Date.now() - 2000);
  });

  it('keeps only http(s) source URLs on the source origin', () => {
    const fallback = 'https://git.example/acme/app/issues/3';
    expect(
      sourceUrl('https://git.example/acme/app/issues/3', 'https://git.example', fallback),
    ).toBe('https://git.example/acme/app/issues/3');
    expect(sourceUrl('javascript:alert(1)', 'https://git.example', fallback)).toBe(fallback);
    expect(sourceUrl('https://evil.example/x', 'https://git.example', fallback)).toBe(fallback);
    expect(sourceUrl(null, 'https://git.example', fallback)).toBe(fallback);
  });
});
