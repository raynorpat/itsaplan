import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpError } from '../../shared/lib';

// HTTP for the import sources. The admin enters the server address, so private and
// internal hosts are allowed (http or https); redirects are not followed, a response
// body is read up to a size limit, a source's rate limit is waited out up to a limit,
// and no error message carries the token.

const TIMEOUT_MS = 30_000;
// The most a source may make one request wait in total for its rate limit; a reset
// further away fails the request as rate limited.
const MAX_TOTAL_WAIT_MS = 60 * 60 * 1000;
// A rate limit answer without a usable reset time (GitHub's secondary limit can come
// without one) is retried after a minute.
const FALLBACK_WAIT_MS = 60_000;
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_ERROR_CHARS = 200;
// The most pages a list is read for; a server that never ends a list stops here.
export const MAX_PAGES = 10_000;

// The server's base URL from what the admin typed: https:// when no scheme is given,
// no trailing slash.
export function baseUrl(host: string): string {
  const raw = host.trim();
  if (!raw) throw new HttpError(400, 'Enter the server address');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new HttpError(400, 'The server address is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new HttpError(400, 'The server address must use http or https');
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

// A source issue's URL as the link back: kept when it is http(s) on the source's own
// origin, else the URL built from the repository and number (`fallback`).
export function sourceUrl(
  raw: string | null | undefined,
  origin: string,
  fallback: string,
): string {
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    const expected = new URL(origin).origin;
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === expected)
      return url.href;
  } catch {
    // not a URL
  }
  return fallback;
}

// Called with the time a request waits until for a rate limit, so an import can show
// it ("Waiting for the source's rate limit until 14:05").
const rateLimitNotice = new AsyncLocalStorage<(until: Date) => void | Promise<void>>();

export function withRateLimitNotice<T>(
  notice: (until: Date) => void | Promise<void>,
  run: () => Promise<T>,
): Promise<T> {
  return rateLimitNotice.run(notice, run);
}

// How long to wait before retrying a rate-limited request, from the source's headers
// (Retry-After in seconds, or a reset time in epoch seconds); null when the response
// is not a rate limit.
function rateLimitWait(res: Response, body: string | null): number | null {
  const limited =
    res.status === 429 ||
    (res.status === 403 &&
      (res.headers.get('x-ratelimit-remaining') === '0' ||
        res.headers.has('retry-after') ||
        /rate limit/i.test(body ?? '')));
  if (!limited) return null;
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter !== null && retryAfter !== '' && !Number.isNaN(Number(retryAfter)))
    return Math.max(Number(retryAfter) * 1000, 0);
  const reset = res.headers.get('x-ratelimit-reset') ?? res.headers.get('ratelimit-reset');
  if (reset !== null && !Number.isNaN(Number(reset)))
    return Math.max(Number(reset) * 1000 - Date.now(), 0);
  return FALLBACK_WAIT_MS;
}

function redact(text: string, token: string): string {
  return token ? text.split(token).join('***') : text;
}

const clock = (at: Date) =>
  `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

// The body as text, at most `max` bytes: past it, an error body (`cut`) is cut there
// and any other body fails the request.
async function readBody(res: Response, max: number, cut: boolean): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (!cut && declared > max) {
    await res.body?.cancel();
    throw new HttpError(502, 'The server answer is too large');
  }
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      if (!cut) throw new HttpError(502, 'The server answer is too large');
      chunks.push(value.subarray(0, value.byteLength - (size - max)));
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// GET a JSON resource with the source's auth headers. Answers the parsed body and
// the response headers (for paging). `secret` is redacted from any error.
export function getJson<T>(
  url: string,
  headers: Record<string, string>,
  secret: string,
): Promise<{ data: T; headers: Headers }> {
  return requestJson<T>('GET', url, headers, undefined, secret);
}

// POST a JSON body (GitHub's token endpoints).
export function postJson<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  secret: string,
): Promise<{ data: T; headers: Headers }> {
  return requestJson<T>('POST', url, headers, body, secret);
}

async function requestJson<T>(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  body: unknown,
  token: string,
): Promise<{ data: T; headers: Headers }> {
  let waited = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      throw new HttpError(502, redact(`Could not reach the server: ${reason}`, token));
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      throw new HttpError(
        502,
        'The server answered with a redirect; enter the address it redirects to',
      );
    }
    if (!res.ok) {
      const text = await readBody(res, MAX_ERROR_CHARS, true);
      const wait = rateLimitWait(res, text);
      if (wait !== null) {
        const until = new Date(Date.now() + wait);
        if (waited + wait > MAX_TOTAL_WAIT_MS)
          throw new HttpError(
            429,
            `The server's rate limit was reached; run the import again after ${clock(until)}`,
          );
        waited += wait;
        if (wait > 0) await rateLimitNotice.getStore()?.(until);
        await Bun.sleep(wait);
        continue;
      }
      if (res.status === 401) throw new HttpError(400, 'The server refused the access token');
      if (res.status === 403)
        throw new HttpError(400, 'The access token is not allowed to read this repository');
      if (res.status === 404) throw new HttpError(404, 'The server has no such repository');
      throw new HttpError(
        502,
        redact(`The server answered ${res.status}: ${text.slice(0, MAX_ERROR_CHARS)}`, token),
      );
    }
    const text = await readBody(res, MAX_BODY_BYTES, false);
    try {
      return { data: JSON.parse(text) as T, headers: res.headers };
    } catch {
      throw new HttpError(502, 'The server did not answer with JSON');
    }
  }
}

// The next page from a `Link: <url>; rel="next"` header (GitHub, Gitea), or null.
export function nextLink(headers: Headers): string | null {
  const link = headers.get('link');
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (m) return m[1]!;
  }
  return null;
}
