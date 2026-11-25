import { HttpError } from '../shared/lib';

// Customer email domains. A person belongs to the customer whose domains hold their
// email's domain (exact, lowercased). Public email providers never group people, so
// their domains are refused on a customer.

export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.de',
  'web.de',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
  'fastmail.com',
  'hey.com',
  'qq.com',
  '163.com',
  '126.com',
]);

const MAX_DOMAINS = 50;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// Lowercased, trimmed, without a leading "@", each once. A public or malformed domain,
// or more than 50, is a 400.
export function cleanDomains(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'domains must be a list of domains');
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new HttpError(400, 'domains must be a list of domains');
    const domain = raw.trim().toLowerCase().replace(/^@/, '');
    if (!DOMAIN_RE.test(domain)) throw new HttpError(400, `${raw} is not a domain`);
    if (PUBLIC_EMAIL_DOMAINS.has(domain))
      throw new HttpError(400, `${domain} is a public email domain`);
    if (!out.includes(domain)) out.push(domain);
  }
  if (out.length > MAX_DOMAINS)
    throw new HttpError(400, `A customer has at most ${MAX_DOMAINS} domains`);
  return out;
}
