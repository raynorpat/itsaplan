import { HttpError } from '../../shared/lib';

// HTTP for the import sources. The admin enters the server address, so private and
// internal hosts are allowed (http or https); redirects are not followed, a source's
// rate limit is waited out, and no error message carries the token.

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 5;
// The longest single wait for a rate limit to reset.
const MAX_WAIT_MS = 60_000;

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

// How long to wait before retrying a rate-limited request, from the source's
// headers (Retry-After in seconds, or a reset time in epoch seconds); null when the
// response is not a rate limit.
function rateLimitWait(res: Response): number | null {
  const limited =
    res.status === 429 ||
    (res.status === 403 &&
      (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')));
  if (!limited) return null;
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter !== null && !Number.isNaN(Number(retryAfter)))
    return Math.min(Number(retryAfter) * 1000, MAX_WAIT_MS);
  const reset = res.headers.get('x-ratelimit-reset') ?? res.headers.get('ratelimit-reset');
  if (reset !== null && !Number.isNaN(Number(reset))) {
    const at = Number(reset) * 1000;
    return Math.min(Math.max(at - Date.now(), 0), MAX_WAIT_MS);
  }
  return 1000;
}

function redact(text: string, token: string): string {
  return token ? text.split(token).join('***') : text;
}

// GET a JSON resource with the source's auth headers. Answers the parsed body and
// the response headers (for paging).
export async function getJson<T>(
  url: string,
  headers: Record<string, string>,
  token: string,
): Promise<{ data: T; headers: Headers }> {
  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json', ...headers },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      throw new HttpError(502, redact(`Could not reach the server: ${reason}`, token));
    }
    if (res.status >= 300 && res.status < 400)
      throw new HttpError(
        502,
        'The server answered with a redirect; enter the address it redirects to',
      );
    const wait = rateLimitWait(res);
    if (wait !== null && attempt < MAX_RETRIES) {
      await res.body?.cancel();
      await Bun.sleep(wait);
      continue;
    }
    if (res.status === 401) throw new HttpError(400, 'The server refused the access token');
    if (res.status === 403)
      throw new HttpError(400, 'The access token is not allowed to read this repository');
    if (res.status === 404) throw new HttpError(404, 'The server has no such repository');
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      throw new HttpError(502, redact(`The server answered ${res.status}: ${text}`, token));
    }
    try {
      return { data: (await res.json()) as T, headers: res.headers };
    } catch {
      throw new HttpError(502, 'The server did not answer with JSON');
    }
  }
}
