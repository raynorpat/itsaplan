import {
  attachment,
  comment,
  customerNeed,
  db,
  externalUser,
  issue,
  issueActivity,
  issueLabel,
  issueRelation,
  portalBoard,
  project,
  projectUpdate,
  projectUpdateShare,
  team,
  user,
  workflowState,
} from '@repo/db';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { emailMayRead } from '../portal/access';
import { boardShowsIssue, type BoardRow } from '../portal/boards';
import type { PublicStatus } from '../portal/status';
import { webOrigin } from '../portal/session';

// What changed for a requester between two moments (feedback project 4): status changes
// of the issues they follow, replies by others in portal threads they wrote in, and
// project updates the team shared. Read from what the app already records
// (issue_activity, comment, project_update_share), within the person's access at
// `until`:
// - only active issues of public teams;
// - a status change when a board the person may read covers the issue, or when the
//   person has form or team-logged feedback on it (then possibly without a link);
// - a reply only from a thread of a board the person may read that covers the issue.
// One lookup serves the change emails, the summaries and the portal's "Since your last
// visit".

export type ChangeStatus = PublicStatus | 'closed';

export type Change =
  | {
      kind: 'status';
      issueId: string;
      identifier: string;
      title: string;
      // null when the earlier state no longer exists.
      from: ChangeStatus | 'underReview' | null;
      to: ChangeStatus;
      duplicateOf: { title: string; url: string | null } | null;
      url: string | null;
      at: Date;
    }
  | {
      kind: 'reply';
      issueId: string;
      identifier: string;
      title: string;
      author: string;
      body: string;
      url: string | null;
      at: Date;
    }
  | {
      kind: 'projectUpdate';
      projectName: string;
      health: 'onTrack' | 'atRisk' | 'offTrack' | null;
      body: string;
      at: Date;
    };

// The status a requester reads for a state type. Unlike a board's public status, a
// completed issue stays "done" however long ago, and a canceled one is "closed".
function changeStatus(stateType: string): ChangeStatus | 'underReview' | null {
  switch (stateType) {
    case 'triage':
      return 'underReview';
    case 'backlog':
    case 'unstarted':
      return 'planned';
    case 'started':
      return 'inProgress';
    case 'completed':
      return 'done';
    case 'canceled':
      return 'closed';
    default:
      return null;
  }
}

interface FollowedIssue {
  id: string;
  identifier: string;
  title: string;
  teamId: string;
  projectId: string | null;
  labelIds: string[];
  // Has form or team-logged feedback: status is sent even when no readable board covers it.
  direct: boolean;
}

// The enabled boards the address may read, by name.
async function readableBoards(email: string | null): Promise<BoardRow[]> {
  const boards = await db
    .select()
    .from(portalBoard)
    .where(eq(portalBoard.enabled, true))
    .orderBy(asc(portalBoard.name));
  return boards.filter((b) => emailMayRead(b, email));
}

// Whether a board's scope (team or project, labels) includes the issue, whatever its
// status: a closed issue is still the board's for its followers.
function covers(board: BoardRow, i: FollowedIssue): boolean {
  const inScope = board.teamId ? board.teamId === i.teamId : board.projectId === i.projectId;
  if (!inScope) return false;
  return board.labelIds.length === 0 || board.labelIds.some((l) => i.labelIds.includes(l));
}

const portalUrl = (board: BoardRow, identifier: string) =>
  `${webOrigin()}/portal/${board.slug}/${identifier}`;

// The issue's page on the first readable board (by name) that shows it now.
async function linkFor(
  boards: BoardRow[],
  issueRow: { id: string; identifier: string },
  until: Date,
): Promise<string | null> {
  for (const board of boards)
    if (await boardShowsIssue(board, issueRow.id, until))
      return portalUrl(board, issueRow.identifier);
  return null;
}

// Active issues of public teams, with their identifier and labels.
async function issueInfo(ids: string[]): Promise<Map<string, Omit<FollowedIssue, 'direct'>>> {
  const out = new Map<string, Omit<FollowedIssue, 'direct'>>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      id: issue.id,
      key: team.key,
      number: issue.sequenceNumber,
      title: issue.title,
      teamId: issue.teamId,
      projectId: issue.projectId,
    })
    .from(issue)
    .innerJoin(team, eq(team.id, issue.teamId))
    .where(and(inArray(issue.id, ids), isNull(issue.archivedAt), eq(team.visibility, 'public')));
  const labels = await db
    .select({ issueId: issueLabel.issueId, labelId: issueLabel.labelId })
    .from(issueLabel)
    .where(
      inArray(
        issueLabel.issueId,
        rows.map((r) => r.id),
      ),
    );
  for (const r of rows)
    out.set(r.id, {
      id: r.id,
      identifier: `${r.key}-${r.number}`,
      title: r.title,
      teamId: r.teamId,
      projectId: r.projectId,
      labelIds: labels.filter((l) => l.issueId === r.id).map((l) => l.labelId),
    });
  return out;
}

// The issues the requester follows through their feedback (with whether any of it came
// from a form or the team) and the portal threads they wrote in.
async function followed(requesterId: string) {
  const needs = await db
    .select({
      issueId: customerNeed.issueId,
      source: sql<string>`coalesce(${attachment.metadata}->>'source', 'team')`,
    })
    .from(customerNeed)
    .innerJoin(attachment, eq(attachment.id, customerNeed.attachmentId))
    .where(and(eq(attachment.externalUserCreatorId, requesterId), isNull(customerNeed.archivedAt)));
  const root = sql`coalesce(${comment.parentId}, ${comment.id})`;
  const threads = await db
    .selectDistinct({
      rootId: sql<string>`r.id`,
      issueId: sql<string>`r.issue_id`,
      boardId: sql<string>`r.portal_board_id`,
    })
    .from(comment)
    .innerJoin(sql`comment r`, sql`r.id = ${root}`)
    .where(
      and(
        eq(comment.externalUserId, requesterId),
        sql`r.portal_thread`,
        sql`r.portal_board_id IS NOT NULL`,
        sql`r.issue_id IS NOT NULL`,
      ),
    );
  return { needs, threads };
}

async function statusChanges(
  issues: FollowedIssue[],
  boards: BoardRow[],
  since: Date,
  until: Date,
): Promise<Change[]> {
  if (issues.length === 0) return [];
  const rows = await db
    .select({
      issueId: issueActivity.issueId,
      fromId: issueActivity.fromId,
      toId: issueActivity.toId,
      at: issueActivity.createdAt,
    })
    .from(issueActivity)
    .where(
      and(
        inArray(
          issueActivity.issueId,
          issues.map((i) => i.id),
        ),
        eq(issueActivity.action, 'status'),
        gt(issueActivity.createdAt, since),
        lte(issueActivity.createdAt, until),
      ),
    )
    .orderBy(asc(issueActivity.createdAt), asc(issueActivity.id));
  if (rows.length === 0) return [];
  const stateIds = [
    ...new Set(rows.flatMap((r) => [r.fromId, r.toId]).filter((x): x is string => !!x)),
  ];
  const states = new Map(
    (
      await db
        .select({ id: workflowState.id, type: workflowState.stateType })
        .from(workflowState)
        .where(inArray(workflowState.id, stateIds))
    ).map((s) => [s.id, s.type]),
  );
  const typeOf = (id: string | null) => (id ? (states.get(id) ?? null) : null);
  const out: Change[] = [];
  for (const i of issues) {
    const own = rows.filter((r) => r.issueId === i.id);
    if (own.length === 0) continue;
    const first = own[0]!;
    const last = own[own.length - 1]!;
    const fromType = typeOf(first.fromId);
    const toType = typeOf(last.toId);
    const from = fromType ? changeStatus(fromType) : null;
    const to = toType ? changeStatus(toType) : null;
    if (!to || to === 'underReview' || from === to) continue;
    out.push({
      kind: 'status',
      issueId: i.id,
      identifier: i.identifier,
      title: i.title,
      from,
      to,
      duplicateOf: to === 'closed' ? await duplicateOf(i.id, boards, until) : null,
      url: await linkFor(boards, i, until),
      at: last.at,
    });
  }
  return out;
}

// The issue this one duplicates, when it is in a public team; its link when a readable
// board shows it.
async function duplicateOf(
  issueId: string,
  boards: BoardRow[],
  until: Date,
): Promise<{ title: string; url: string | null } | null> {
  const [rel] = await db
    .select({ relatedId: issueRelation.relatedIssueId })
    .from(issueRelation)
    .where(and(eq(issueRelation.issueId, issueId), eq(issueRelation.type, 'duplicate')));
  if (!rel) return null;
  const info = (await issueInfo([rel.relatedId])).get(rel.relatedId);
  if (!info) return null;
  return { title: info.title, url: await linkFor(boards, info, until) };
}

async function replies(
  requesterId: string,
  threads: { rootId: string; issueId: string; boardId: string }[],
  infos: Map<string, Omit<FollowedIssue, 'direct'>>,
  boards: BoardRow[],
  since: Date,
  until: Date,
): Promise<Change[]> {
  const usable = threads.filter((t) => {
    const board = boards.find((b) => b.id === t.boardId);
    const info = infos.get(t.issueId);
    return board && info && covers(board, { ...info, direct: false });
  });
  if (usable.length === 0) return [];
  const rows = await db
    .select({
      rootId: sql<string>`coalesce(${comment.parentId}, ${comment.id})`,
      body: comment.body,
      at: comment.createdAt,
      userId: comment.userId,
      memberName: sql<string | null>`nullif(trim(${user.name}), '')`,
      externalUserId: comment.externalUserId,
      visitorName: externalUser.displayName,
    })
    .from(comment)
    .leftJoin(user, eq(user.id, comment.userId))
    .leftJoin(externalUser, eq(externalUser.id, comment.externalUserId))
    .where(
      and(
        inArray(
          sql`coalesce(${comment.parentId}, ${comment.id})`,
          usable.map((t) => t.rootId),
        ),
        gt(comment.createdAt, since),
        lte(comment.createdAt, until),
        or(isNull(comment.externalUserId), ne(comment.externalUserId, requesterId)),
      ),
    )
    .orderBy(asc(comment.createdAt), asc(comment.id));
  const out: Change[] = [];
  for (const r of rows) {
    const thread = usable.find((t) => t.rootId === r.rootId)!;
    const info = infos.get(thread.issueId)!;
    const board = boards.find((b) => b.id === thread.boardId)!;
    // As on the portal: a member without a name is "Team", a rule's comment "Automation".
    let author: string;
    if (r.externalUserId) author = r.visitorName ?? 'Portal visitor';
    else if (r.userId) author = r.memberName ?? 'Team';
    else author = 'Automation';
    out.push({
      kind: 'reply',
      issueId: info.id,
      identifier: info.identifier,
      title: info.title,
      author,
      body: r.body,
      url: (await boardShowsIssue(board, info.id, until))
        ? portalUrl(board, info.identifier)
        : null,
      at: r.at,
    });
  }
  return out;
}

async function projectUpdates(projectIds: string[], since: Date, until: Date): Promise<Change[]> {
  if (projectIds.length === 0) return [];
  const rows = await db
    .select({
      projectName: project.name,
      health: projectUpdate.health,
      body: projectUpdate.body,
      at: projectUpdateShare.sharedAt,
    })
    .from(projectUpdateShare)
    .innerJoin(projectUpdate, eq(projectUpdate.id, projectUpdateShare.projectUpdateId))
    .innerJoin(project, eq(project.id, projectUpdate.projectId))
    .where(
      and(
        inArray(projectUpdate.projectId, projectIds),
        isNull(projectUpdate.archivedAt),
        isNull(project.archivedAt),
        gt(projectUpdateShare.sharedAt, since),
        lte(projectUpdateShare.sharedAt, until),
      ),
    )
    .orderBy(asc(projectUpdateShare.sharedAt));
  return rows.map((r) => ({
    kind: 'projectUpdate' as const,
    projectName: r.projectName,
    health: (r.health as 'onTrack' | 'atRisk' | 'offTrack') ?? null,
    body: r.body,
    at: r.at,
  }));
}

// Everything that changed for the requester in (since, until], oldest first.
export async function requesterChanges(
  requesterId: string,
  since: Date,
  until: Date,
): Promise<Change[]> {
  const [person] = await db
    .select({ email: externalUser.email })
    .from(externalUser)
    .where(eq(externalUser.id, requesterId));
  if (!person) return [];
  const boards = await readableBoards(person.email);
  const { needs, threads } = await followed(requesterId);
  const infos = await issueInfo([
    ...new Set([...needs.map((n) => n.issueId), ...threads.map((t) => t.issueId)]),
  ]);
  const direct = new Set(needs.filter((n) => n.source !== 'portal').map((n) => n.issueId));
  const statusIssues: FollowedIssue[] = [];
  for (const info of infos.values()) {
    const i = { ...info, direct: direct.has(info.id) };
    if (i.direct || boards.some((b) => covers(b, i))) statusIssues.push(i);
  }
  const changes = [
    ...(await statusChanges(statusIssues, boards, since, until)),
    ...(await replies(requesterId, threads, infos, boards, since, until)),
    ...(await projectUpdates(
      [...new Set(statusIssues.map((i) => i.projectId).filter((p): p is string => !!p))],
      since,
      until,
    )),
  ];
  return changes.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// Requesters who may have something new after `since`: updates on, an email, not
// blocked or merged, and following an issue with a status change, a portal thread with
// a new comment, or a project with a newly shared update. requesterChanges decides what
// each of them gets.
export async function requestersWithChangesSince(since: Date): Promise<string[]> {
  // Raw SQL parameters are sent as text.
  const after = since.toISOString();
  const viaNeeds = db
    .selectDistinct({ id: attachment.externalUserCreatorId })
    .from(customerNeed)
    .innerJoin(attachment, eq(attachment.id, customerNeed.attachmentId))
    .innerJoin(issue, eq(issue.id, customerNeed.issueId))
    .where(
      and(
        isNull(customerNeed.archivedAt),
        isNotNull(attachment.externalUserCreatorId),
        or(
          sql`EXISTS (SELECT 1 FROM issue_activity a WHERE a.issue_id = ${issue.id}
            AND a.action = 'status' AND a.created_at > ${after})`,
          sql`${issue.projectId} IN (SELECT pu.project_id FROM project_update_share s
            JOIN project_update pu ON pu.id = s.project_update_id WHERE s.shared_at > ${after})`,
        ),
      ),
    );
  // People who wrote in a portal thread follow its issue too: a new comment in the
  // thread, a status change of the issue or a shared update of its project.
  const viaThreads = db
    .selectDistinct({ id: comment.externalUserId })
    .from(comment)
    .where(
      and(
        isNotNull(comment.externalUserId),
        sql`EXISTS (SELECT 1 FROM comment r WHERE r.id = coalesce(${comment.parentId}, ${comment.id})
          AND r.portal_thread)`,
        or(
          sql`EXISTS (SELECT 1 FROM comment c WHERE c.created_at > ${after}
            AND coalesce(c.parent_id, c.id) = coalesce(${comment.parentId}, ${comment.id}))`,
          sql`EXISTS (SELECT 1 FROM issue_activity a WHERE a.issue_id = ${comment.issueId}
            AND a.action = 'status' AND a.created_at > ${after})`,
          sql`EXISTS (SELECT 1 FROM issue i JOIN project_update pu ON pu.project_id = i.project_id
            JOIN project_update_share s ON s.project_update_id = pu.id
            WHERE i.id = ${comment.issueId} AND s.shared_at > ${after})`,
        ),
      ),
    );
  const ids = [
    ...new Set(
      [...(await viaNeeds), ...(await viaThreads)].map((r) => r.id).filter((x): x is string => !!x),
    ),
  ];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: externalUser.id })
    .from(externalUser)
    .where(
      and(
        inArray(externalUser.id, ids),
        eq(externalUser.updatesEnabled, true),
        isNotNull(externalUser.email),
        isNull(externalUser.portalBlockedAt),
        isNull(externalUser.mergedIntoId),
      ),
    );
  return rows.map((r) => r.id);
}
