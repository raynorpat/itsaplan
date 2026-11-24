import { db, issue, issueLabel, portalBoard, team, workflowState } from '@repo/db';
import { and, eq, gte, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DONE_DAYS } from './status';

// Portal boards (portal_board): which issues a board shows. A board shows the active
// (not archived) issues of its team or project that are in a public team, have any of
// its labels when it has some, and have a public status (status.ts).

export type BoardRow = typeof portalBoard.$inferSelect;

// The enabled board with this slug, or null.
export async function getBoardBySlug(slug: string): Promise<BoardRow | null> {
  const [row] = await db
    .select()
    .from(portalBoard)
    .where(and(eq(portalBoard.slug, slug), eq(portalBoard.enabled, true)));
  return row ?? null;
}

// SQL over `issue` (joined with its state): the issues the board shows at `now`.
function shownSql(board: BoardRow, now: Date): SQL {
  const doneSince = new Date(now.getTime() - DONE_DAYS * 86_400_000);
  return and(
    isNull(issue.archivedAt),
    board.teamId ? eq(issue.teamId, board.teamId) : eq(issue.projectId, board.projectId!),
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

export const boardIssueIds = (board: BoardRow, now: Date): Promise<string[]> =>
  shownIds(board, now);

export async function boardShowsIssue(
  board: BoardRow,
  issueId: string,
  now: Date,
): Promise<boolean> {
  return (await shownIds(board, now, eq(issue.id, issueId))).length > 0;
}

// The enabled boards showing the issue now.
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
        or(
          eq(portalBoard.teamId, row.teamId),
          row.projectId ? eq(portalBoard.projectId, row.projectId) : sql`false`,
        ),
      ),
    )
    .orderBy(portalBoard.name);
  const now = new Date();
  const shown: BoardRow[] = [];
  for (const board of candidates) if (await boardShowsIssue(board, issueId, now)) shown.push(board);
  return shown;
}
