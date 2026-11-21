import { randomUUID } from 'node:crypto';
import { db, issue, teamView } from '@repo/db';
import { eq } from 'drizzle-orm';
import { getTeamById, type TeamRow } from '../teams/store';
import { listStates } from '../states/store';
import { listIssueTypes } from '../issue-types/store';
import { listLabels, listLabelGroups } from '../labels/store';
import { listCustomFields } from '../custom-fields/store';
import { listAssigneeCandidates } from '../members/store';
import { getIssue, getIssueFieldValues, listIssues, type IssueRow } from '../issues/store';
import { listFeed, type FeedItemRow } from '../issues/activity';
import { applyFilters } from '../views/filters';

// Public read-only sharing: an issue or a saved view carries an unguessable
// share_token that, when set, makes it readable without a session through the
// /share/* routes. Enabling sets the token; revoking clears it. The public reads
// return a self-contained bundle (team scaffold + the entity) so the read-only
// page needs no other authenticated call.

// The team scaffold a read-only page needs to render issues: the same shape as
// GET /teams/:teamKey minus the caller's viewer/permissions. Member emails
// are stripped — a public page shows names, never emails.
export interface ShareScaffold {
  team: TeamRow;
  states: Awaited<ReturnType<typeof listStates>>;
  issueTypes: Awaited<ReturnType<typeof listIssueTypes>>;
  labels: Awaited<ReturnType<typeof listLabels>>;
  labelGroups: Awaited<ReturnType<typeof listLabelGroups>>;
  assignees: Array<{
    userId: string;
    name: string;
    image: string | null;
    kind: 'member' | 'agent';
    agentKind: 'external' | 'internal' | null;
  }>;
  customFields: Awaited<ReturnType<typeof listCustomFields>>;
}

export interface SharedIssueBundle {
  team: ShareScaffold;
  issue: IssueRow & { fields: Awaited<ReturnType<typeof getIssueFieldValues>> };
  feed: FeedItemRow[];
}

export interface SharedViewBundle {
  team: ShareScaffold;
  view: { name: string; icon: string | null; filters: unknown; display: unknown };
  issues: IssueRow[];
}

async function buildScaffold(team: TeamRow): Promise<ShareScaffold> {
  const [states, issueTypes, labels, labelGroups, assignees, customFields] = await Promise.all([
    listStates(team.id),
    listIssueTypes(team.id),
    listLabels(team.id),
    listLabelGroups(team.id),
    listAssigneeCandidates(team.id),
    listCustomFields(team.id, { allTypes: true }),
  ]);
  return {
    team,
    states,
    issueTypes,
    labels,
    labelGroups,
    // Drop the email — a public page renders names and avatars only.
    assignees: assignees.map((a) => ({
      userId: a.userId,
      name: a.name,
      image: a.image,
      kind: a.kind,
      agentKind: a.agentKind,
    })),
    customFields,
  };
}

// The read-only feed shows the newest activity; a public share never paginates,
// so it is capped at the store's max page (100). An issue with more than that
// shows its latest 100 entries.
async function issueFeed(issueId: string): Promise<FeedItemRow[]> {
  const page = await listFeed(issueId, { limit: 100 });
  return page.items;
}

// Builds the read-only bundle for one issue, shared by the shared-issue page and
// a card opened from a shared board. keepShareToken keeps the issue's own share
// token in the bundle; it is meaningful only on the shared-issue page and stripped
// elsewhere, so a shared board never leaks its issues' individual tokens.
async function issueBundle(
  issueRow: IssueRow,
  keepShareToken: boolean,
): Promise<SharedIssueBundle> {
  const team = await getTeamById(issueRow.teamId);
  if (!team) throw new Error('team missing for shared issue');
  const [scaffold, fields, feed] = await Promise.all([
    buildScaffold(team),
    getIssueFieldValues(issueRow.id),
    issueFeed(issueRow.id),
  ]);
  return {
    team: scaffold,
    issue: { ...issueRow, shareToken: keepShareToken ? issueRow.shareToken : null, fields },
    feed,
  };
}

// --- Enable / revoke ------------------------------------------------------------

// Enables sharing for an issue. Idempotent: an already-shared issue keeps its
// token. Returns the token, or null if the issue does not exist.
export async function enableIssueShare(issueId: string): Promise<string | null> {
  const rows = await db
    .select({ token: issue.shareToken })
    .from(issue)
    .where(eq(issue.id, issueId));
  if (rows.length === 0) return null;
  if (rows[0].token) return rows[0].token;
  const token = randomUUID();
  await db.update(issue).set({ shareToken: token }).where(eq(issue.id, issueId));
  return token;
}

// Revokes sharing for an issue. Returns false if the issue does not exist.
export async function disableIssueShare(issueId: string): Promise<boolean> {
  const rows = await db
    .update(issue)
    .set({ shareToken: null })
    .where(eq(issue.id, issueId))
    .returning({ id: issue.id });
  return rows.length > 0;
}

export async function enableViewShare(viewId: string): Promise<string | null> {
  const rows = await db
    .select({ token: teamView.shareToken })
    .from(teamView)
    .where(eq(teamView.id, viewId));
  if (rows.length === 0) return null;
  if (rows[0].token) return rows[0].token;
  const token = randomUUID();
  await db.update(teamView).set({ shareToken: token }).where(eq(teamView.id, viewId));
  return token;
}

export async function disableViewShare(viewId: string): Promise<boolean> {
  const rows = await db
    .update(teamView)
    .set({ shareToken: null })
    .where(eq(teamView.id, viewId))
    .returning({ id: teamView.id });
  return rows.length > 0;
}

// --- Public reads ---------------------------------------------------------------

// The bundle for a shared issue link, or null if no issue carries the token.
export async function getSharedIssue(token: string): Promise<SharedIssueBundle | null> {
  const issueId = await issueIdByToken(token);
  const issueRow = issueId ? await getIssue(issueId) : null;
  if (!issueRow) return null;
  return issueBundle(issueRow, true);
}

// The bundle for a shared view link, or null if no view carries the token.
export async function getSharedView(token: string): Promise<SharedViewBundle | null> {
  const rows = await db.select().from(teamView).where(eq(teamView.shareToken, token));
  const view = rows[0];
  if (!view) return null;
  const team = await getTeamById(view.teamId);
  if (!team) return null;
  const [scaffold, issues] = await Promise.all([buildScaffold(team), listIssues(team)]);
  // Apply the view's own filters here so the bundle carries only the issues the
  // view shows, not the whole team. A public link must not expose issues the
  // filter excludes.
  const visible = applyFilters(issues, view.filters, scaffold.states);
  return {
    team: scaffold,
    view: { name: view.name, icon: view.icon, filters: view.filters, display: view.display },
    // A shared board never leaks its issues' own individual share tokens.
    issues: visible.map((i) => ({ ...i, shareToken: null })),
  };
}

// The read-only detail of one issue opened from a shared board. Enforces that the
// issue is one the shared view actually shows: it must belong to the view's team
// and pass the view's filters, so the board token cannot open issues the filter
// excludes (nor archived issues, which listIssues omits). Null if the token is
// unknown or the issue is not on the shared board.
export async function getSharedViewIssue(
  token: string,
  issueId: string,
): Promise<SharedIssueBundle | null> {
  const rows = await db
    .select({ teamId: teamView.teamId, filters: teamView.filters })
    .from(teamView)
    .where(eq(teamView.shareToken, token));
  if (rows.length === 0) return null;
  const team = await getTeamById(rows[0].teamId);
  if (!team) return null;
  const [columns, issues] = await Promise.all([listStates(team.id), listIssues(team)]);
  const issueRow = applyFilters(issues, rows[0].filters, columns).find((i) => i.id === issueId);
  if (!issueRow) return null;
  return issueBundle(issueRow, false);
}

// Resolves an issue share token to its issue id, or null when unknown.
async function issueIdByToken(token: string): Promise<string | null> {
  const rows = await db.select({ id: issue.id }).from(issue).where(eq(issue.shareToken, token));
  return rows[0]?.id ?? null;
}
