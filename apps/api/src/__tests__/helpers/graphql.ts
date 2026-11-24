import { setWorkspaceRole, type WorkspaceRole } from '../../shared/access';
import { signUpTestUser, type TestUser } from './auth';
import { gql, type GqlError } from './linear';

// Test setup through the GraphQL API. Each helper runs one Linear mutation or query
// as the given user and throws when it returns errors, so a broken setup fails the
// test at the line that set it up. `as` is anything carrying a session cookie (a
// TestUser), or the request headers to send (an API key or OAuth token).

export type As = { cookie: string } | { headers: Record<string, string> };

function headersOf(as: As): Record<string, string> {
  return 'headers' in as ? as.headers : { cookie: as.cookie };
}

// GraphQL results are read field by field in the tests; their shape is the query's.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Data = Record<string, any>;

// Runs a query or mutation and returns its data; throws with the errors otherwise.
export async function gqlData<T = Data>(
  as: As,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await gql(headersOf(as), query, variables);
  if (res.body.errors?.length || !res.body.data) {
    const message = (res.body.errors ?? []).map((e: GqlError) => e.message).join('; ');
    throw new Error(`GraphQL failed (${res.status}): ${message || 'no data'}`);
  }
  return res.body.data as T;
}

export interface TeamState {
  id: string;
  name: string;
  stateType: string;
  position: number;
}

export interface TeamView {
  team: { id: string; key: string; name: string; private: boolean };
  states: TeamState[];
  labels: { id: string; name: string; isGroup: boolean; parentId: string | null }[];
  members: { id: string; owner: boolean; userId: string }[];
}

// A team's id, states (in position order, typed as stateType like the board) and
// labels, read by key.
export async function teamView(as: As, key: string): Promise<TeamView> {
  const data = await gqlData(
    as,
    `query ($id: String!) { team(id: $id) {
      id key name private
      states(first: 250) { nodes { id name type position } }
      labels(first: 250) { nodes { id name isGroup parent { id } } }
      memberships(first: 250) { nodes { id owner user { id } } }
    } }`,
    { id: key },
  );
  const t = data.team as {
    id: string;
    key: string;
    name: string;
    private: boolean;
    states: { nodes: { id: string; name: string; type: string; position: number }[] };
    labels: {
      nodes: { id: string; name: string; isGroup: boolean; parent: { id: string } | null }[];
    };
    memberships: { nodes: { id: string; owner: boolean; user: { id: string } }[] };
  };
  return {
    team: { id: t.id, key: t.key, name: t.name, private: t.private },
    states: t.states.nodes
      .map((s) => ({ id: s.id, name: s.name, stateType: s.type, position: s.position }))
      .sort((a, b) => a.position - b.position),
    labels: t.labels.nodes.map((l) => ({
      id: l.id,
      name: l.name,
      isGroup: l.isGroup,
      parentId: l.parent?.id ?? null,
    })),
    members: t.memberships.nodes.map((m) => ({ id: m.id, owner: m.owner, userId: m.user.id })),
  };
}

// The first state of each type, by type: { backlog, unstarted, started, ... }.
export function statesByType(view: TeamView): Record<string, string> {
  const byType: Record<string, string> = {};
  for (const s of view.states) byType[s.stateType] ??= s.id;
  return byType;
}

// Creates a team (the creator becomes its owner); `private` makes it private.
export async function createTeam(
  as: As,
  input: {
    key: string;
    name?: string;
    description?: string;
    private?: boolean;
    visibility?: 'public' | 'private';
  },
): Promise<TeamView> {
  const data = await gqlData(
    as,
    `mutation ($input: TeamCreateInput!) { teamCreate(input: $input) { team { id } } }`,
    { input: { key: input.key, name: input.name ?? input.key, description: input.description } },
  );
  if (input.private || input.visibility === 'private')
    await makePrivate(as, data.teamCreate.team.id);
  return teamView(as, input.key);
}

export async function updateTeam(
  as: As,
  idOrKey: string,
  input: Record<string, unknown>,
): Promise<void> {
  await gqlData(
    as,
    `mutation ($id: String!, $input: TeamUpdateInput!) { teamUpdate(id: $id, input: $input) { success } }`,
    { id: idOrKey, input },
  );
}

export async function makePrivate(as: As, idOrKey: string): Promise<void> {
  await updateTeam(as, idOrKey, { private: true });
}

// Adds a user to a team (or the caller to a public team when userId is their own).
// Returns the membership id.
export async function addMember(as: As, teamIdOrKey: string, userId: string): Promise<string> {
  const teamId = await teamIdOf(as, teamIdOrKey);
  const data = await gqlData(
    as,
    `mutation ($input: TeamMembershipCreateInput!) {
      teamMembershipCreate(input: $input) { teamMembership { id } } }`,
    { input: { teamId, userId } },
  );
  return data.teamMembershipCreate.teamMembership.id;
}

export async function removeMember(as: As, membershipId: string): Promise<void> {
  await gqlData(as, `mutation ($id: String!) { teamMembershipDelete(id: $id) { success } }`, {
    id: membershipId,
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function teamIdOf(as: As, idOrKey: string): Promise<string> {
  if (UUID.test(idOrKey)) return idOrKey;
  const data = await gqlData(as, `query ($id: String!) { team(id: $id) { id } }`, { id: idOrKey });
  return data.team.id;
}

export async function createState(
  as: As,
  input: { teamId: string; name: string; type: string; color?: string },
): Promise<{ id: string; name: string; type: string; position: number }> {
  input = { ...input, teamId: await teamIdOf(as, input.teamId) };
  const data = await gqlData(
    as,
    `mutation ($input: WorkflowStateCreateInput!) {
      workflowStateCreate(input: $input) { workflowState { id name type position } } }`,
    { input: { color: '#6b7280', ...input } },
  );
  return data.workflowStateCreate.workflowState;
}

export async function createLabel(
  as: As,
  input: {
    name: string;
    teamId?: string;
    color?: string;
    isGroup?: boolean;
    parentId?: string;
    description?: string;
  },
): Promise<{ id: string; name: string }> {
  if (input.teamId) input = { ...input, teamId: await teamIdOf(as, input.teamId) };
  const data = await gqlData(
    as,
    `mutation ($input: IssueLabelCreateInput!) {
      issueLabelCreate(input: $input) { issueLabel { id name } } }`,
    { input: { color: '#6b7280', ...input } },
  );
  return data.issueLabelCreate.issueLabel;
}

export interface CreatedIssue {
  id: string;
  identifier: string;
  number: number;
  // The same value as `number`, under the store's name.
  sequenceNumber: number;
  title: string;
  url: string;
  stateId: string;
  teamId: string;
}

const ISSUE_FIELDS = 'id identifier number title url state { id } team { id }';

function toCreatedIssue(i: Data): CreatedIssue {
  return {
    id: i.id,
    identifier: i.identifier,
    number: i.number,
    sequenceNumber: i.number,
    title: i.title,
    url: i.url,
    stateId: i.state.id,
    teamId: i.team.id,
  };
}

// Creates an issue. teamId may be a team key; the title defaults to "Task".
export async function createIssue(
  as: As,
  input: { teamId: string; title?: string } & Record<string, unknown>,
): Promise<CreatedIssue> {
  const teamId = await teamIdOf(as, input.teamId);
  const data = await gqlData(
    as,
    `mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { issue { ${ISSUE_FIELDS} } } }`,
    { input: { title: 'Task', ...input, teamId } },
  );
  return toCreatedIssue(data.issueCreate.issue);
}

export async function updateIssue(
  as: As,
  id: string,
  input: Record<string, unknown>,
): Promise<CreatedIssue> {
  const data = await gqlData(
    as,
    `mutation ($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { issue { ${ISSUE_FIELDS} } } }`,
    { id, input },
  );
  return toCreatedIssue(data.issueUpdate.issue);
}

export async function archiveIssue(as: As, id: string): Promise<void> {
  await gqlData(as, `mutation ($id: String!) { issueArchive(id: $id) { success } }`, { id });
}

export async function createComment(
  as: As,
  input: { issueId?: string; documentContentId?: string; body: string; parentId?: string } & Record<
    string,
    unknown
  >,
): Promise<{ id: string; body: string }> {
  const data = await gqlData(
    as,
    `mutation ($input: CommentCreateInput!) { commentCreate(input: $input) { comment { id body } } }`,
    { input },
  );
  return data.commentCreate.comment;
}

export async function createProject(
  as: As,
  input: { name: string; teamIds: string[] } & Record<string, unknown>,
): Promise<{ id: string; name: string; slugId: string }> {
  const teamIds = await Promise.all(input.teamIds.map((t) => teamIdOf(as, t)));
  const data = await gqlData(
    as,
    `mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { project { id name slugId } } }`,
    { input: { ...input, teamIds } },
  );
  return data.projectCreate.project;
}

export async function createCycle(
  as: As,
  input: { teamId: string; startsAt: string; endsAt: string } & Record<string, unknown>,
): Promise<{ id: string; number: number }> {
  const teamId = await teamIdOf(as, input.teamId);
  const data = await gqlData(
    as,
    `mutation ($input: CycleCreateInput!) { cycleCreate(input: $input) { cycle { id number } } }`,
    { input: { ...input, teamId } },
  );
  return data.cycleCreate.cycle;
}

export async function createDocument(
  as: As,
  input: { title: string } & Record<string, unknown>,
): Promise<{ id: string; title: string; slugId: string }> {
  const data = await gqlData(
    as,
    `mutation ($input: DocumentCreateInput!) { documentCreate(input: $input) { document { id title slugId } } }`,
    { input },
  );
  return data.documentCreate.document;
}

export async function createInitiative(
  as: As,
  input: { name: string } & Record<string, unknown>,
): Promise<{ id: string; name: string }> {
  const data = await gqlData(
    as,
    `mutation ($input: InitiativeCreateInput!) { initiativeCreate(input: $input) { initiative { id name } } }`,
    { input },
  );
  return data.initiativeCreate.initiative;
}

export async function createView(
  as: As,
  input: { name: string } & Record<string, unknown>,
): Promise<{ id: string; name: string }> {
  const data = await gqlData(
    as,
    `mutation ($input: CustomViewCreateInput!) { customViewCreate(input: $input) { customView { id name } } }`,
    { input },
  );
  return data.customViewCreate.customView;
}

// A team webhook (teamId may be a team key) or, with allPublicTeams, an all-teams one.
export async function createWebhook(
  as: As,
  input: { url: string; resourceTypes: string[]; teamId?: string } & Record<string, unknown>,
): Promise<{ id: string; secret: string | null }> {
  if (input.teamId) input = { ...input, teamId: await teamIdOf(as, input.teamId) };
  const data = await gqlData(
    as,
    `mutation ($input: WebhookCreateInput!) { webhookCreate(input: $input) { webhook { id secret } } }`,
    { input },
  );
  return data.webhookCreate.webhook;
}

// Signs up a user and gives them a workspace role (the role is set directly, as
// signUpWithRole does, since the first user is the only owner who could grant it).
export async function signUpAs(
  role: WorkspaceRole,
  overrides: { email?: string; name?: string } = {},
): Promise<TestUser> {
  const u = await signUpTestUser(overrides);
  await setWorkspaceRole(u.userId, role);
  return u;
}
