// The audit log page's filters, their GraphQL and export forms, and a one-line summary
// of an entry from its type and metadata.

export interface AuditLogFilters {
  type: string | null;
  actorId: string | null;
  ip: string;
  // Days as YYYY-MM-DD, in UTC; `to` includes the whole day.
  from: string;
  to: string;
}

export const NO_FILTERS: AuditLogFilters = { type: null, actorId: null, ip: '', from: '', to: '' };

export const AUDIT_RETENTIONS = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
  { value: '2y', label: '2 years' },
  { value: '3y', label: '3 years' },
  { value: 'forever', label: 'Forever' },
] as const;

export type AuditRetention = (typeof AUDIT_RETENTIONS)[number]['value'];

const startOf = (day: string) => `${day}T00:00:00.000Z`;

function nextDay(day: string): string {
  const d = new Date(startOf(day));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

const endOf = (day: string) => new Date(new Date(nextDay(day)).getTime() - 1).toISOString();

// Linear's AuditEntryFilter for `auditEntries`; undefined without filters.
export function auditEntryFilter(f: AuditLogFilters): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (f.type) out.type = { eq: f.type };
  if (f.actorId) out.actor = { id: { eq: f.actorId } };
  if (f.ip.trim()) out.ip = { eq: f.ip.trim() };
  const createdAt: Record<string, string> = {};
  if (f.from) createdAt.gte = startOf(f.from);
  if (f.to) createdAt.lt = nextDay(f.to);
  if (Object.keys(createdAt).length > 0) out.createdAt = createdAt;
  return Object.keys(out).length > 0 ? out : undefined;
}

// The CSV export's POST body for the same filters (`to` is inclusive).
export function auditExportBody(f: AuditLogFilters): Record<string, string> {
  const body: Record<string, string> = {};
  if (f.type) body.type = f.type;
  if (f.actorId) body.actorId = f.actorId;
  if (f.ip.trim()) body.ip = f.ip.trim();
  if (f.from) body.from = startOf(f.from);
  if (f.to) body.to = endOf(f.to);
  return body;
}

const text = (v: unknown): string | null =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : null;

// A code such as "notInvited" in words ("not invited").
const words = (code: string): string => code.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const SIGN_IN_METHODS: Record<string, string> = {
  magicLink: 'with a magic link',
  google: 'with Google',
  passkey: 'with a passkey',
};

// "name Workspace → Raynor Studio; logo …" for a settings change, at most three fields.
function changesText(changes: unknown): string | null {
  if (!changes || typeof changes !== 'object') return null;
  const parts = Object.entries(changes as Record<string, { from?: unknown; to?: unknown }>)
    .slice(0, 3)
    .map(([field, c]) => `${words(field)} ${text(c?.from) ?? '—'} → ${text(c?.to) ?? '—'}`);
  return parts.length > 0 ? parts.join('; ') : null;
}

// The details after the action's description, by what the metadata carries. `people`
// names the user an entry is about (user ids to names).
function details(
  type: string,
  m: Record<string, unknown>,
  people?: Map<string, string>,
): string | null {
  if (type === 'loginFailed') {
    const attempts =
      typeof m.attempts === 'number' && m.attempts > 1 ? `, ${m.attempts} attempts` : '';
    const reason = `(${text(m.reason) ? words(String(m.reason)) : 'unknown'})`;
    if (m.scope === 'ip') {
      const n = typeof m.addresses === 'number' ? m.addresses : 1;
      return `${n} more ${n === 1 ? 'address' : 'addresses'} from this IP ${reason}${attempts}`;
    }
    const address = text(m.address) ?? '';
    return `${address ? `${address} ` : ''}${reason}${attempts}`;
  }
  if (type === 'login') {
    const method = text(m.method);
    return method ? (SIGN_IN_METHODS[method] ?? words(method)) : null;
  }
  if (type === 'dataExported') {
    const kind = text(m.kind);
    const what = [kind ? words(kind) : null, text(m.name)].filter(Boolean).join(' ');
    const rows = typeof m.rows === 'number' ? `${m.rows} ${m.rows === 1 ? 'row' : 'rows'}` : null;
    return [what || null, rows].filter(Boolean).join(', ') || null;
  }
  if (type.startsWith('invite') && text(m.email)) {
    const role = text(m.role);
    return `${m.email}${role ? ` as ${role}` : ''}`;
  }
  const changed = changesText(m.changes);
  if (changed) return changed;
  const person =
    m.entityType === 'user' && typeof m.entityId === 'string'
      ? (people?.get(m.entityId) ?? null)
      : null;
  const period = (v: string | null) =>
    type === 'auditRetentionChanged'
      ? (AUDIT_RETENTIONS.find((r) => r.value === v)?.label.toLowerCase() ?? v)
      : v;
  const from = period(text(m.from));
  const to = period(text(m.to));
  if (from != null && to != null) return `${person ? `${person}, ` : ''}${from} → ${to}`;
  return person ?? text(m.name) ?? text(m.entityIdentifier);
}

// One line for an entry: its type's description (else the type), the details its
// metadata gives, and a note when earlier entries could not be written.
export function describeEntry(
  entry: { type: string; metadata: Record<string, unknown> | null },
  description: string | null,
  people?: Map<string, string>,
): string {
  const base = description ?? entry.type;
  const m = entry.metadata ?? {};
  const more = details(entry.type, m, people);
  const missed =
    typeof m.missedEntries === 'number' && m.missedEntries > 0
      ? ` (${m.missedEntries} earlier ${m.missedEntries === 1 ? 'entry was' : 'entries were'} not recorded)`
      : '';
  return `${base}${more ? `: ${more}` : ''}${missed}`;
}
