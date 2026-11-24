import { sql, type SQL } from 'drizzle-orm';
import { user } from '@repo/db';

// A magic-link sign-up has no name. Like Linear, such an account is named after its
// email's local part until the person sets one. Every place that shows, stores,
// sends or filters on a user's name uses this name.

export function shownName(u: { name: string | null; email: string }): string {
  return u.name?.trim() || u.email.split('@')[0]!;
}

// The same name as a SQL expression on the `user` table, for selects and filters.
export const shownNameSql: SQL<string> = sql<string>`coalesce(nullif(trim(${user.name}), ''), split_part(${user.email}, '@', 1))`;
