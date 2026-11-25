import { customer, db, issue, label, portalBoard, project, team, workflowState } from '@repo/db';
import { getActiveSession, type PortalHandlers } from '@repo/auth';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { createLabel } from '../labels/store';
import { assertWorkspaceRole, canSeeTeam, workspaceRole } from '../shared/access';
import { HttpError, iso, pgErrorCode, UUID_RE } from '../shared/lib';
import { assertParentAccess } from '../comments/store';
import { assertCustomersEnabled } from '../customers/settings';
import { boardIssueIds, boardShowsIssue, boardsShowingIssue, type BoardRow } from './boards';
import { startPortalThread } from './comments';
import { setPortalBlocked } from './session';

// The instance plugin's portal endpoints (/api/auth/instance/portal/*): owners and
// admins manage the boards; members read which boards show an issue. Linear's schema
// has no portal, so none of this is in GraphQL.

export interface BoardDto {
  id: string;
  slug: string;
  name: string;
  intro: string;
  teamId: string | null;
  projectId: string | null;
  labelIds: string[];
  // 'issues': the team's or project's issues; 'customerRequests': the issues the
  // board's customer asked for (Customer access only).
  shows: 'issues' | 'customerRequests';
  access: 'public' | 'restricted' | 'customer';
  // The customer whose people read a board with Customer access; null when that
  // customer was deleted (then no one reads the board).
  customerId: string | null;
  customer: { id: string; name: string } | null;
  allowedDomains: string[];
  allowedEmails: string[];
  showDescription: boolean;
  comments: 'portal' | 'all';
  suggestionsEnabled: boolean;
  suggestionTeamId: string | null;
  suggestionStateId: string | null;
  suggestionLabelId: string | null;
  enabled: boolean;
  issueCount: number;
  createdAt: string;
  updatedAt: string;
}

const SLUG_RE = /^[a-z0-9-]{1,48}$/;
// Paths under /portal/ in the web app that are not boards.
const RESERVED_SLUGS = new Set(['unsubscribe']);
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 255;
const MAX_INTRO = 10_000;
const MAX_LIST = 500;
export const SUGGESTION_LABEL = 'Portal';

async function signedIn(headers: Headers) {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return session.user;
}

async function admin(headers: Headers) {
  return assertWorkspaceRole(await signedIn(headers), 'admin');
}

async function toDto(row: BoardRow): Promise<BoardDto> {
  const [owner] = row.customerId
    ? await db
        .select({ id: customer.id, name: customer.name })
        .from(customer)
        .where(eq(customer.id, row.customerId))
    : [];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    intro: row.intro,
    teamId: row.teamId,
    projectId: row.projectId,
    labelIds: row.labelIds,
    shows: row.shows as BoardDto['shows'],
    access: row.access as BoardDto['access'],
    customerId: row.customerId,
    customer: owner ?? null,
    allowedDomains: row.allowedDomains,
    allowedEmails: row.allowedEmails,
    showDescription: row.showDescription,
    comments: row.comments as BoardDto['comments'],
    suggestionsEnabled: row.suggestionsEnabled,
    suggestionTeamId: row.suggestionTeamId,
    suggestionStateId: row.suggestionStateId,
    suggestionLabelId: row.suggestionLabelId,
    enabled: row.enabled,
    issueCount: (await boardIssueIds(row, new Date())).length,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// --- Input -----------------------------------------------------------------------

type BoardFields = Omit<
  typeof portalBoard.$inferInsert,
  'id' | 'createdAt' | 'updatedAt' | 'createdById'
>;

const fields = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

function text(value: unknown, what: string, max: number, required: boolean): string {
  if (typeof value !== 'string' || (required && !value.trim()))
    throw new HttpError(400, `${what} is required`);
  const out = value.trim();
  if (out.length > max) throw new HttpError(400, `${what} is at most ${max} characters`);
  return out;
}

function idOrNull(value: unknown, what: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value))
    throw new HttpError(400, `${what} must be an id`);
  return value;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, `${what} must be true or false`);
  return value;
}

function list(value: unknown, what: string, pattern: RegExp): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${what} must be a list`);
  if (value.length > MAX_LIST) throw new HttpError(400, `${what} has at most ${MAX_LIST} entries`);
  const out = new Set<string>();
  for (const item of value) {
    const v = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (!pattern.test(v)) throw new HttpError(400, `${what}: "${String(item)}" is not valid`);
    out.add(v);
  }
  return [...out];
}

// The fields present in `body`, checked one by one.
function parseFields(body: Record<string, unknown>): Partial<BoardFields> {
  const out: Partial<BoardFields> = {};
  if ('slug' in body) {
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!SLUG_RE.test(slug))
      throw new HttpError(400, 'slug must be 1–48 lowercase letters, digits or dashes');
    if (RESERVED_SLUGS.has(slug)) throw new HttpError(400, `"${slug}" cannot be a board's slug`);
    out.slug = slug;
  }
  if ('name' in body) out.name = text(body.name, 'name', MAX_NAME, true);
  if ('intro' in body) out.intro = text(body.intro ?? '', 'intro', MAX_INTRO, false);
  if ('teamId' in body) out.teamId = idOrNull(body.teamId, 'teamId');
  if ('projectId' in body) out.projectId = idOrNull(body.projectId, 'projectId');
  if ('labelIds' in body) {
    if (!Array.isArray(body.labelIds)) throw new HttpError(400, 'labelIds must be a list');
    out.labelIds = [...new Set(body.labelIds.map((id) => idOrNull(id, 'labelIds')!))];
  }
  if ('access' in body) {
    if (body.access !== 'public' && body.access !== 'restricted' && body.access !== 'customer')
      throw new HttpError(400, 'access must be public, restricted or customer');
    out.access = body.access;
  }
  if ('shows' in body) {
    if (body.shows !== 'issues' && body.shows !== 'customerRequests')
      throw new HttpError(400, 'shows must be issues or customerRequests');
    out.shows = body.shows;
  }
  if ('customerId' in body) out.customerId = idOrNull(body.customerId, 'customerId');
  if ('allowedDomains' in body)
    out.allowedDomains = list(body.allowedDomains, 'allowedDomains', DOMAIN_RE);
  if ('allowedEmails' in body)
    out.allowedEmails = list(body.allowedEmails, 'allowedEmails', EMAIL_RE);
  if ('showDescription' in body)
    out.showDescription = bool(body.showDescription, 'showDescription');
  if ('comments' in body) {
    if (body.comments !== 'portal' && body.comments !== 'all')
      throw new HttpError(400, 'comments must be portal or all');
    out.comments = body.comments;
  }
  if ('suggestionsEnabled' in body)
    out.suggestionsEnabled = bool(body.suggestionsEnabled, 'suggestionsEnabled');
  if ('suggestionTeamId' in body)
    out.suggestionTeamId = idOrNull(body.suggestionTeamId, 'suggestionTeamId');
  if ('suggestionStateId' in body)
    out.suggestionStateId = idOrNull(body.suggestionStateId, 'suggestionStateId');
  if ('suggestionLabelId' in body)
    out.suggestionLabelId = idOrNull(body.suggestionLabelId, 'suggestionLabelId');
  if ('enabled' in body) out.enabled = bool(body.enabled, 'enabled');
  return out;
}

async function assertPublicTeam(teamId: string, what: string): Promise<void> {
  const [row] = await db
    .select({ visibility: team.visibility })
    .from(team)
    .where(eq(team.id, teamId));
  if (!row) throw new HttpError(400, `${what} is not a team`);
  if (row.visibility !== 'public') throw new HttpError(400, `${what} must be a public team`);
}

// The team's suggestion label: the given one (a label of the team or the workspace),
// else the team's "Portal" label, created when missing.
async function suggestionLabel(
  teamId: string,
  labelId: string | null | undefined,
  actorId: string,
): Promise<string> {
  const inScope = or(eq(label.teamId, teamId), isNull(label.teamId));
  if (labelId) {
    const [row] = await db
      .select({ id: label.id })
      .from(label)
      .where(
        and(eq(label.id, labelId), inScope, eq(label.isGroup, false), isNull(label.retiredAt)),
      );
    if (!row) throw new HttpError(400, 'suggestionLabelId must be a label of the suggestion team');
    return row.id;
  }
  const [existing] = await db
    .select({ id: label.id })
    .from(label)
    .where(
      and(eq(label.teamId, teamId), eq(label.name, SUGGESTION_LABEL), eq(label.isGroup, false)),
    );
  if (existing) return existing.id;
  return (await createLabel({ teamId, name: SUGGESTION_LABEL, actorUserId: actorId })).id;
}

// Checks the whole board after a change and fills the suggestion label.
async function validated(
  board: Partial<BoardFields>,
  actorId: string,
): Promise<Partial<BoardFields>> {
  if (!board.slug) throw new HttpError(400, 'slug is required');
  if (!board.name) throw new HttpError(400, 'name is required');
  if (board.shows === 'customerRequests') {
    if (board.access !== 'customer')
      throw new HttpError(400, "A board of a customer's requests needs Customer access");
    if (board.teamId || board.projectId)
      throw new HttpError(400, "A board of a customer's requests has no team or project");
  } else if (!board.teamId === !board.projectId)
    throw new HttpError(400, 'A board shows exactly one team or one project');
  if (board.access === 'customer') {
    await assertCustomersEnabled();
    if (!board.customerId) throw new HttpError(400, 'customerId is required for Customer access');
    const [row] = await db
      .select({ id: customer.id })
      .from(customer)
      .where(eq(customer.id, board.customerId));
    if (!row) throw new HttpError(400, 'customerId is not a customer');
  } else board = { ...board, customerId: null };
  if (board.teamId) await assertPublicTeam(board.teamId, 'teamId');
  if (board.projectId) {
    const [row] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, board.projectId), isNull(project.archivedAt)));
    if (!row) throw new HttpError(400, 'projectId is not a project');
  }
  const labelIds = board.labelIds ?? [];
  if (labelIds.length > 0) {
    const found = await db
      .select({ id: label.id })
      .from(label)
      .where(and(inArray(label.id, labelIds), eq(label.isGroup, false)));
    if (found.length !== labelIds.length) throw new HttpError(400, 'labelIds must be labels');
  }
  if (!board.suggestionsEnabled) return board;
  if (!board.suggestionTeamId) throw new HttpError(400, 'suggestionTeamId is required');
  await assertPublicTeam(board.suggestionTeamId, 'suggestionTeamId');
  const [state] = board.suggestionStateId
    ? await db
        .select({ id: workflowState.id })
        .from(workflowState)
        .where(
          and(
            eq(workflowState.id, board.suggestionStateId),
            eq(workflowState.teamId, board.suggestionTeamId),
            isNull(workflowState.archivedAt),
          ),
        )
    : [];
  if (!state) throw new HttpError(400, 'suggestionStateId must be a state of the suggestion team');
  return {
    ...board,
    suggestionLabelId: await suggestionLabel(
      board.suggestionTeamId,
      board.suggestionLabelId,
      actorId,
    ),
  };
}

function rethrowSlug(err: unknown): never {
  if (pgErrorCode(err) === '23505') throw new HttpError(409, 'This board address is taken');
  throw err;
}

async function findBoard(id: unknown): Promise<BoardRow> {
  const boardId = idOrNull(id, 'id');
  const [row] = boardId
    ? await db.select().from(portalBoard).where(eq(portalBoard.id, boardId))
    : [];
  if (!row) throw new HttpError(404, 'Board not found');
  return row;
}

// --- Handlers --------------------------------------------------------------------

export const portalHandlers: PortalHandlers = {
  boards: async (headers) => {
    await admin(headers);
    const rows = await db.select().from(portalBoard).orderBy(asc(portalBoard.name));
    return { boards: await Promise.all(rows.map(toDto)) };
  },
  createBoard: async (headers, body) => {
    const user = await admin(headers);
    const values = await validated(parseFields(fields(body)), user.id);
    const [row] = await db
      .insert(portalBoard)
      .values({ ...(values as BoardFields), createdById: user.id })
      .returning()
      .catch(rethrowSlug);
    return { board: await toDto(row!) };
  },
  updateBoard: async (headers, body) => {
    const user = await admin(headers);
    const input = fields(body);
    const current = await findBoard(input.id);
    const { id: _id, createdAt: _c, updatedAt: _u, createdById: _b, ...rest } = current;
    const values = await validated({ ...rest, ...parseFields(input) }, user.id);
    const [row] = await db
      .update(portalBoard)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(portalBoard.id, current.id))
      .returning()
      .catch(rethrowSlug);
    return { board: await toDto(row!) };
  },
  deleteBoard: async (headers, body) => {
    await admin(headers);
    const board = await findBoard(fields(body).id);
    await db.delete(portalBoard).where(eq(portalBoard.id, board.id));
    return { success: true };
  },
  block: async (headers, body) => {
    await admin(headers);
    const input = fields(body);
    await setPortalBlocked(input.requesterId, input.blocked);
    return { success: true };
  },
  issueBoards: async (headers, query) => {
    const user = await signedIn(headers);
    const issueId = idOrNull(query.issueId, 'issueId');
    const [row] = issueId
      ? await db.select({ teamId: issue.teamId }).from(issue).where(eq(issue.id, issueId))
      : [];
    if (!row || !(await canSeeTeam(row.teamId, user.id)))
      throw new HttpError(404, 'Issue not found');
    if ((await workspaceRole(user.id)) === 'guest')
      throw new HttpError(403, 'Guests do not see the portal');
    const boards = await boardsShowingIssue(issueId!);
    return {
      boards: boards.map((b) => ({ id: b.id, slug: b.slug, name: b.name, comments: b.comments })),
    };
  },
  comment: async (headers, body) => {
    const user = await signedIn(headers);
    const input = fields(body);
    const issueId = idOrNull(input.issueId, 'issueId');
    if (!issueId) throw new HttpError(400, 'issueId is required');
    await assertParentAccess({ issueId }, user);
    if ((await workspaceRole(user.id)) === 'guest')
      throw new HttpError(403, 'Guests cannot post on the portal');
    const board = await findBoard(input.boardId);
    const shown = board.enabled && (await boardShowsIssue(board, issueId, new Date()));
    const created = await startPortalThread(board, issueId, user.id, input.body, shown);
    return { id: created.id };
  },
};
