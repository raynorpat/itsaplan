import {
  attachment,
  comment,
  customerNeed,
  db,
  externalUser,
  issue,
  team,
  workflowState,
} from '@repo/db';
import { and, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { requesterCountSql } from '../feedback/store';
import { boardCustomer, boardIssueIds, boardShowsIssue, type BoardRow } from './boards';
import type { Visitor } from './session';
import { publicStatus, type PublicStatus } from './status';

// The issues a visitor reads on a board: the board's own (boards.ts) plus, for a
// signed-in visitor, their own suggestions the board does not show yet ("under
// review"). Votes are the issue's people asking (project 1's customerCount); on a board
// with Customer access, only the board customer's people.

export interface PortalIssue {
  identifier: string;
  title: string;
  status: PublicStatus;
  votes: number;
  comments: number;
  voted: boolean;
  underReview: boolean;
}

export interface PortalIssueDetail extends PortalIssue {
  description: string | null;
}

export type PortalSort = 'top' | 'new';

// SQL over `comment`: the comments a board shows. A thread belongs to the board its
// root names (replies are stored under the root). "portal": the board's own threads;
// "all": every comment except portal threads of other boards, including threads of a
// deleted board (their root keeps `portal_thread`).
// On a board with Customer access, only threads whose root a member wrote or one of the
// customer's people (by their current customer) wrote, and within them no comment by a
// person outside the customer.
export function boardCommentsSql(board: BoardRow): SQL {
  const root = sql`(CASE WHEN ${comment.parentId} IS NULL THEN ${comment.id} ELSE ${comment.parentId} END)`;
  const ownThread = sql`EXISTS (SELECT 1 FROM ${comment} r
    WHERE r.id = ${root} AND r.portal_board_id = ${board.id})`;
  const portalThread = sql`EXISTS (SELECT 1 FROM ${comment} r
    WHERE r.id = ${root} AND r.portal_thread)`;
  const shown = board.comments === 'all' ? sql`(NOT ${portalThread} OR ${ownThread})` : ownThread;
  const customerId = boardCustomer(board);
  if (board.access !== 'customer') return shown;
  if (!customerId) return sql`false`;
  const people = sql`(SELECT ${externalUser.id} FROM ${externalUser}
    WHERE ${externalUser.customerId} = ${customerId})`;
  const rootByCustomer = sql`EXISTS (SELECT 1 FROM ${comment} r
    WHERE r.id = ${root} AND (r.external_user_id IS NULL OR r.external_user_id IN ${people}))`;
  const byCustomer = sql`(${comment.externalUserId} IS NULL OR ${comment.externalUserId} IN ${people})`;
  return sql`(${shown} AND ${rootByCustomer} AND ${byCustomer})`;
}

// The vote count of the outer `issue` row on the board: the people asking, or on a board
// with Customer access the board customer's people asking.
export function boardVotesSql(board: BoardRow): SQL<number> {
  const customerId = boardCustomer(board);
  if (board.access !== 'customer') return requesterCountSql();
  if (!customerId) return sql<number>`0`;
  return sql<number>`(
    SELECT count(DISTINCT ${attachment.externalUserCreatorId})::int
    FROM ${customerNeed}
    JOIN ${attachment} ON ${attachment.id} = ${customerNeed.attachmentId}
    WHERE ${customerNeed.issueId} = ${issue.id}
      AND ${customerNeed.archivedAt} IS NULL
      AND ${customerNeed.customerId} = ${customerId}
      AND ${attachment.externalUserCreatorId} IS NOT NULL
  )`;
}

const titleHas = (word: string): SQL =>
  ilike(issue.title, `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

// The search box: titles holding every word of `q`.
function titleMatches(q: string): SQL | undefined {
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  return and(...words.map(titleHas));
}

// Similar issues: the words of `q` of two or more characters.
const similarWords = (q: string): string[] => q.split(/\s+/).filter((w) => w.length >= 2);

// The visitor's own issues submitted from this board (a suggestion or a form), in a
// public team.
async function ownSuggestionIds(board: BoardRow, visitor: Visitor | null): Promise<string[]> {
  if (!visitor) return [];
  const rows = await db
    .select({ id: issue.id })
    .from(issue)
    .innerJoin(team, eq(team.id, issue.teamId))
    .where(
      and(
        eq(issue.externalUserCreatorId, visitor.requesterId),
        eq(issue.portalSourceBoardId, board.id),
        eq(team.visibility, 'public'),
        isNull(issue.archivedAt),
      ),
    );
  return rows.map((r) => r.id);
}

// Reads the given issues as the visitor sees them, leaving out any without a public
// status. `shown` holds the ids the board itself shows; the rest are under review.
async function readIssues(
  board: BoardRow,
  visitor: Visitor | null,
  ids: string[],
  shown: Set<string>,
  now: Date,
  options: { q?: string; sort?: PortalSort; anyOf?: string[] } = {},
): Promise<PortalIssueDetail[]> {
  if (ids.length === 0) return [];
  const votedSql = visitor
    ? sql<boolean>`EXISTS (
        SELECT 1 FROM ${customerNeed}
        JOIN ${attachment} ON ${attachment.id} = ${customerNeed.attachmentId}
        WHERE ${customerNeed.issueId} = ${issue.id}
          AND ${customerNeed.archivedAt} IS NULL
          AND ${attachment.externalUserCreatorId} = ${visitor.requesterId})`
    : sql<boolean>`false`;
  const votes = boardVotesSql(board);
  // With `anyOf`, titles holding any of the words, those holding more of them first.
  const anyOf = options.anyOf ?? [];
  const matched = sql`(${sql.join(
    anyOf.map((w) => sql`(CASE WHEN ${titleHas(w)} THEN 1 ELSE 0 END)`),
    sql` + `,
  )})`;
  const rows = await db
    .select({
      id: issue.id,
      teamKey: team.key,
      number: issue.sequenceNumber,
      title: issue.title,
      description: issue.description,
      stateType: workflowState.stateType,
      completedAt: issue.completedAt,
      votes,
      comments: sql<number>`(SELECT count(*)::int FROM ${comment}
        WHERE ${comment.issueId} = ${issue.id} AND ${boardCommentsSql(board)})`,
      voted: votedSql,
    })
    .from(issue)
    .innerJoin(team, eq(team.id, issue.teamId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(
      and(
        inArray(issue.id, ids),
        options.q ? titleMatches(options.q) : undefined,
        anyOf.length ? or(...anyOf.map(titleHas)) : undefined,
      ),
    )
    .orderBy(
      ...(anyOf.length ? [sql`${matched} DESC`] : []),
      ...(options.sort === 'new'
        ? [sql`${issue.createdAt} DESC`]
        : [sql`${votes} DESC`, sql`${issue.createdAt} DESC`]),
      issue.id,
    );
  const out: PortalIssueDetail[] = [];
  for (const row of rows) {
    const underReview = !shown.has(row.id);
    // A visitor's own suggestion still in triage reads as planned, under review.
    const status =
      publicStatus(row.stateType, row.completedAt, now) ??
      (underReview && row.stateType === 'triage' ? 'planned' : null);
    if (!status) continue;
    out.push({
      identifier: `${row.teamKey}-${row.number}`,
      title: row.title,
      status,
      votes: row.votes,
      comments: row.comments,
      voted: row.voted,
      underReview,
      description: board.showDescription ? row.description : null,
    });
  }
  return out;
}

const listItem = ({ description: _, ...item }: PortalIssueDetail): PortalIssue => item;

// The board's issues ordered by votes (top) or creation (new), narrowed by title words,
// with the visitor's own suggestions under review.
export async function listBoardIssues(
  board: BoardRow,
  visitor: Visitor | null,
  options: { q?: string; sort?: PortalSort },
  now = new Date(),
): Promise<PortalIssue[]> {
  const shown = await boardIssueIds(board, now);
  const own = await ownSuggestionIds(board, visitor);
  const ids = [...new Set([...shown, ...own])];
  return (await readIssues(board, visitor, ids, new Set(shown), now, options)).map(listItem);
}

// Up to 5 board issues whose titles hold any word of `q` (two characters or more),
// those matching more words first, then most votes.
export async function similarIssues(
  board: BoardRow,
  visitor: Visitor | null,
  q: string,
  now = new Date(),
): Promise<PortalIssue[]> {
  const anyOf = similarWords(q);
  if (anyOf.length === 0) return [];
  const shown = await boardIssueIds(board, now);
  const found = await readIssues(board, visitor, shown, new Set(shown), now, {
    anyOf,
    sort: 'top',
  });
  return found.slice(0, 5).map(listItem);
}

// Whether the visitor may read the issue on the board: the board shows it, or it is
// their own suggestion.
export async function visitorMayReadIssue(
  board: BoardRow,
  visitor: Visitor | null,
  issueId: string,
  now = new Date(),
): Promise<boolean> {
  if (await boardShowsIssue(board, issueId, now)) return true;
  return (await ownSuggestionIds(board, visitor)).includes(issueId);
}

// The issue `identifier` ("ENG-12") when the visitor may read it on the board: the
// board shows it, or it is their own suggestion. Null otherwise.
export async function findBoardIssue(
  board: BoardRow,
  visitor: Visitor | null,
  identifier: string,
  now = new Date(),
): Promise<{ id: string; detail: PortalIssueDetail } | null> {
  const match = /^([A-Za-z0-9]+)-(\d+)$/.exec(identifier);
  if (!match) return null;
  const [row] = await db
    .select({ id: issue.id })
    .from(issue)
    .innerJoin(team, eq(team.id, issue.teamId))
    .where(and(eq(team.key, match[1]!.toUpperCase()), eq(issue.sequenceNumber, Number(match[2]))));
  if (!row) return null;
  const shown = await boardShowsIssue(board, row.id, now);
  if (!shown && !(await ownSuggestionIds(board, visitor)).includes(row.id)) return null;
  const [detail] = await readIssues(board, visitor, [row.id], new Set(shown ? [row.id] : []), now);
  return detail ? { id: row.id, detail } : null;
}
