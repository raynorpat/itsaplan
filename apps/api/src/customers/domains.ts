import { db } from '@repo/db';
import { sql, type SQL } from 'drizzle-orm';
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

// --- Matching ---------------------------------------------------------------------

// `db` or a transaction: matching runs inside the writer's transaction.
type Runner = Pick<typeof db, 'execute'>;

const idList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

const emailDomain = sql`lower(split_part(p.email, '@', 2))`;

// Applies the domain rule to the people in scope (every person when `personIds` is
// omitted): a person not picked by hand belongs to the customer whose domains hold
// their email's domain, and loses a domain link that no longer matches. People picked
// by hand keep their customer. The changed people's requests move with them.
export async function matchPeople(tx: Runner, scope: { personIds?: string[] } = {}): Promise<void> {
  if (scope.personIds && scope.personIds.length === 0) return;
  // Customer writes hold this lock exclusively while they change domains and match
  // everyone; a person write waits for them here, so neither misses the other's rows.
  if (scope.personIds)
    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtext('customer-keys'))`);
  const inScope: SQL = scope.personIds ? sql`AND p.id IN (${idList(scope.personIds)})` : sql``;
  const unlinked = await tx.execute<{ id: string }>(sql`
    UPDATE external_user p SET customer_id = NULL, customer_source = NULL
    WHERE p.customer_source = 'domain' ${inScope}
      AND NOT EXISTS (
        SELECT 1 FROM customer c
        WHERE c.id = p.customer_id AND c.domains @> ARRAY[${emailDomain}]::text[]
      )
    RETURNING p.id`);
  const linked = await tx.execute<{ id: string }>(sql`
    UPDATE external_user p SET customer_id = c.id, customer_source = 'domain'
    FROM customer c
    WHERE p.merged_into_id IS NULL AND p.email IS NOT NULL
      AND (p.customer_id IS NULL OR p.customer_source IS DISTINCT FROM 'manual')
      AND p.customer_id IS DISTINCT FROM c.id
      AND c.domains @> ARRAY[${emailDomain}]::text[]
      ${inScope}
    RETURNING p.id`);
  const changed = [...new Set([...unlinked, ...linked].map((r) => r.id))];
  await syncNeedCustomers(tx, changed);
}

// Gives the people's requests their person's customer: one statement, no webhooks and
// no `updated_at` change, since only the grouping changed.
export async function syncNeedCustomers(tx: Runner, personIds: string[]): Promise<void> {
  if (personIds.length === 0) return;
  await tx.execute(sql`
    UPDATE customer_need n SET customer_id = p.customer_id
    FROM attachment a JOIN external_user p ON p.id = a.external_user_creator_id
    WHERE a.id = n.attachment_id AND p.id IN (${idList(personIds)})
      AND n.customer_id IS DISTINCT FROM p.customer_id`);
}
