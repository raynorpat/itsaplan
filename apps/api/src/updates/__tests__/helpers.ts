import { db } from '@repo/db';
import { sql } from 'drizzle-orm';

// Moves the clock forward by `minutes` for the requester update runs: every time they
// compare (history, comments, shared updates, release and completion times, sent
// shipments and each person's markers) moves back by
// that much, so a run with `new Date()` sees the database as it would be later.
export async function later(minutes: number): Promise<void> {
  const by = sql.raw(`interval '${Number(minutes)} minutes'`);
  await db.execute(sql`UPDATE issue_activity SET created_at = created_at - ${by}`);
  await db.execute(sql`UPDATE comment SET created_at = created_at - ${by}`);
  await db.execute(sql`UPDATE project_update_share SET shared_at = shared_at - ${by}`);
  await db.execute(sql`UPDATE issue_to_release SET created_at = created_at - ${by}`);
  await db.execute(sql`UPDATE release SET completed_at = completed_at - ${by}`);
  await db.execute(sql`UPDATE issue SET completed_at = completed_at - ${by}`);
  await db.execute(sql`UPDATE requester_shipped SET sent_at = sent_at - ${by}`);
  await db.execute(sql`UPDATE external_user SET
    changes_sent_until = changes_sent_until - ${by},
    summary_sent_until = summary_sent_until - ${by},
    last_change_email_at = last_change_email_at - ${by},
    last_visit_at = last_visit_at - ${by},
    previous_visit_at = previous_visit_at - ${by}`);
}
