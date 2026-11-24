import type { SourcePerson } from './types';

// Pure helpers of the import engine.

// Linear's issue title limit.
export const MAX_TITLE = 255;

// A title over the limit is cut; the full title then opens the description.
export function splitTitle(title: string, body: string): { title: string; description: string } {
  const clean = title.trim() || 'Untitled';
  if (clean.length <= MAX_TITLE) return { title: clean, description: body };
  return {
    title: clean.slice(0, MAX_TITLE),
    description: body ? `${clean}\n\n${body}` : clean,
  };
}

// A source label colour ("d73a4a", "#ABC", "#d73a4a", none) as "#rrggbb", or null
// when it is not a hex colour (the label then takes the default colour).
export function normalizeColor(color: string | null): string | null {
  if (!color) return null;
  const hex = color.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex))
    return `#${hex
      .split('')
      .map((c) => c + c)
      .join('')}`;
  return null;
}

export const personName = (p: SourcePerson): string => p.name?.trim() || p.login;

// A source date as a Date no later than now (a source clock ahead of ours would
// otherwise fail Linear's "in the past" rule).
export function pastDate(value: string, now: Date = new Date()): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return now;
  return d.getTime() > now.getTime() ? now : d;
}

// Suggested member for each source person: the member whose sign-in address or a
// confirmed extra address equals the person's email, else the one whose name equals
// the person's name or login (ignoring case). A match shared by several members
// suggests no one.
export function suggestPeople(
  people: SourcePerson[],
  members: { id: string; emails: string[]; name: string }[],
): Record<string, string | null> {
  const only = (ids: string[]) => (new Set(ids).size === 1 ? ids[0]! : null);
  const out: Record<string, string | null> = {};
  for (const p of people) {
    const email = p.email?.trim().toLowerCase();
    const byEmail = email
      ? members.filter((m) => m.emails.some((e) => e.toLowerCase() === email)).map((m) => m.id)
      : [];
    if (byEmail.length) {
      out[p.key] = only(byEmail);
      continue;
    }
    const names = [p.name, p.login]
      .filter((v): v is string => !!v?.trim())
      .map((v) => v.trim().toLowerCase());
    const byName = members
      .filter((m) => names.includes(m.name.trim().toLowerCase()))
      .map((m) => m.id);
    out[p.key] = byName.length ? only(byName) : null;
  }
  return out;
}

// The key of a team an import creates by name, as Linear derives one (the name's
// letters and digits, uppercased, starting with a letter, at most 5); attempt `n > 1`
// ends with n so a taken key gets a free variant ("ACME", "ACME2", …).
export function teamKeyFor(name: string, n: number): string {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/^[0-9]+/, '')
      .slice(0, 5) || 'IMP';
  if (n <= 1) return base;
  const suffix = String(n);
  return base.slice(0, Math.max(1, 5 - suffix.length)) + suffix;
}
