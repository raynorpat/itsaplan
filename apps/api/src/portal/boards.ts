import { customerNeed, db, issue, issueLabel, portalBoard, team, workflowState } from '@repo/db';
import { and, eq, gte, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { customersOnSql } from '../feedback/store';
import { DONE_DAYS } from './status';

// Portal boards (portal_board): which issues a board shows. A board shows the active
// (not archived) issues of its team or project (`shows` 'issues') or the issues its
// customer asked for (`shows` 'customerRequests': an active feedback item with the
// board's customer), that are in a public team, have any of its labels when it has
// some, and have a public status (status.ts). Boards with Customer access are not
// served while Customers is off.

// Customer boards only while Customers is on.
const servedSql = or(ne(portalBoard.access, 'customer'), customersOnSql)!;

export type BoardRow = typeof portalBoard.$inferSelect;

// The enabled board with this slug, or null.
export async function getBoardBySlug(slug: string): Promise<BoardRow | null> {
  const [row] = await db
    .select()
    .from(portalBoard)
    .where(and(eq(portalBoard.slug, slug), eq(portalBoard.enabled, true), servedSql));
  return row ?? null;
}

// The issues with an active feedback item of the customer.
const askedBy = (customerId: string) =>
  db
    .select({ id: customerNeed.issueId })
    .from(customerNeed)
    .where(and(eq(customerNeed.customerId, customerId), isNull(customerNeed.archivedAt)));

// SQL over `issue`: the board's scope (its team, its project, or its customer's requests).
function scopeSql(board: BoardRow): SQL {
  if (board.shows === 'customerRequests')
    return board.customerId ? inArray(issue.id, askedBy(board.customerId)) : sql`false`;
  return board.teamId ? eq(issue.teamId, board.teamId) : eq(issue.projectId, board.projectId!);
}

// SQL over `issue` (joined with its state): the issues the board shows at `now`.
function shownSql(board: BoardRow, now: Date): SQL {
  const doneSince = new Date(now.getTime() - DONE_DAYS * 86_400_000);
  return and(
    isNull(issue.archivedAt),
    scopeSql(board),
    inArray(
      issue.teamId,
      db.select({ id: team.id }).from(team).where(eq(team.visibility, 'public')),
    ),
    board.labelIds.length > 0
      ? inArray(
          issue.id,
          db
            .select({ id: issueLabel.issueId })
            .from(issueLabel)
            .where(inArray(issueLabel.labelId, board.labelIds)),
        )
      : undefined,
    or(
      inArray(workflowState.stateType, ['backlog', 'unstarted', 'started']),
      and(eq(workflowState.stateType, 'completed'), gte(issue.completedAt, doneSince)),
    ),
  )!;
}

async function shownIds(board: BoardRow, now: Date, extra?: SQL): Promise<string[]> {
  const rows = await db
    .select({ id: issue.id })
    .from(issue)
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(and(shownSql(board, now), extra));
  return rows.map((r) => r.id);
}

// The customer whose people alone count on the board (votes, threads), or null.
export const boardCustomer = (board: BoardRow): string | null =>
  board.access === 'customer' ? board.customerId : null;

export const boardIssueIds = (board: BoardRow, now: Date): Promise<string[]> =>
  shownIds(board, now);

export async function boardShowsIssue(
  board: BoardRow,
  issueId: string,
  now: Date,
): Promise<boolean> {
  return (await shownIds(board, now, eq(issue.id, issueId))).length > 0;
}

// The enabled boards showing the issue now (customer boards only while Customers is on).
export async function boardsShowingIssue(issueId: string): Promise<BoardRow[]> {
  const [row] = await db
    .select({ teamId: issue.teamId, projectId: issue.projectId })
    .from(issue)
    .where(eq(issue.id, issueId));
  if (!row) return [];
  const candidates = await db
    .select()
    .from(portalBoard)
    .where(
      and(
        eq(portalBoard.enabled, true),
        servedSql,
        or(
          eq(portalBoard.teamId, row.teamId),
          row.projectId ? eq(portalBoard.projectId, row.projectId) : sql`false`,
          and(
            eq(portalBoard.shows, 'customerRequests'),
            inArray(
              portalBoard.customerId,
              db
                .select({ id: customerNeed.customerId })
                .from(customerNeed)
                .where(and(eq(customerNeed.issueId, issueId), isNull(customerNeed.archivedAt))),
            ),
          ),
        ),
      ),
    )
    .orderBy(portalBoard.name);
  const now = new Date();
  const shown: BoardRow[] = [];
  for (const board of candidates) if (await boardShowsIssue(board, issueId, now)) shown.push(board);
  return shown;
}
