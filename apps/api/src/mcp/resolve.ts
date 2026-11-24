import { ToolError, type Gql } from './graphql';

// Turns what a person or model writes (a name, a key, an email, part of a name) into
// the id a GraphQL operation takes, as Linear's MCP tools do. Every lookup runs as the
// caller, so it finds only what the caller can see. A reference that matches several
// records is refused with the candidates, so no tool acts on a guess.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

const lower = (value: string) => value.trim().toLowerCase();

// The single match, or a ToolError naming the candidates (or that nothing matched).
function pick<T>(kind: string, ref: string, matches: T[], describe: (m: T) => string): T {
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new ToolError(`No ${kind} matches "${ref}"`);
  throw new ToolError(
    `"${ref}" matches several ${kind}s: ${matches.map(describe).join('; ')}. ` +
      'Use the full name or the id.',
  );
}

// Matches in order of strength: the first rule that finds anything decides.
function bestMatches<T>(items: T[], rules: ((item: T) => boolean)[]): T[] {
  for (const rule of rules) {
    const found = items.filter(rule);
    if (found.length) return found;
  }
  return [];
}

export interface TeamRef {
  id: string;
  key: string;
  name: string;
}

// A team by id, key or name (any case), then by part of its name.
export async function resolveTeam(gql: Gql, ref: string): Promise<TeamRef> {
  const data = await gql<{ teams: { nodes: TeamRef[] } }>(
    'query { teams(first: 250) { nodes { id key name } } }',
  );
  const r = lower(ref);
  const matches = bestMatches(data.teams.nodes, [
    (t) => t.id === ref.trim(),
    (t) => lower(t.key) === r,
    (t) => lower(t.name) === r,
    (t) => lower(t.name).includes(r),
  ]);
  return pick('team', ref, matches, (t) => `${t.name} (${t.key})`);
}

export interface UserRef {
  id: string;
  name: string;
  email: string;
}

const USER_FIELDS = 'id name email';

// A person by "me", id, email, or name; part of a name or email matches when nothing
// matches exactly.
export async function resolveUser(gql: Gql, ref: string): Promise<UserRef> {
  const r = ref.trim();
  if (lower(r) === 'me')
    return (await gql<{ viewer: UserRef }>(`query { viewer { ${USER_FIELDS} } }`)).viewer;
  if (isUuid(r)) {
    const data = await gql<{ users: { nodes: UserRef[] } }>(
      `query($id: ID!) { users(filter: { id: { eq: $id } }) { nodes { ${USER_FIELDS} } } }`,
      { id: r },
    );
    return pick('user', ref, data.users.nodes, describeUser);
  }
  const data = await gql<{ users: { nodes: UserRef[] } }>(
    `query($q: String!) { users(first: 250, filter: { or: [
      { name: { containsIgnoreCase: $q } }, { email: { containsIgnoreCase: $q } } ] }) {
      nodes { ${USER_FIELDS} } } }`,
    { q: r },
  );
  const matches = bestMatches(data.users.nodes, [
    (u) => lower(u.email) === lower(r),
    (u) => lower(u.name) === lower(r),
    () => true,
  ]);
  return pick('user', ref, matches, describeUser);
}

const describeUser = (u: UserRef) => `${u.name} <${u.email}> (id ${u.id})`;

export interface StateRef {
  id: string;
  name: string;
  type: string;
  position: number;
}

export const STATE_TYPES = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'];

export async function teamStates(gql: Gql, teamId: string): Promise<StateRef[]> {
  const data = await gql<{ team: { states: { nodes: StateRef[] } } }>(
    `query($id: String!) { team(id: $id) {
      states(first: 250) { nodes { id name type position } } } }`,
    { id: teamId },
  );
  return [...data.team.states.nodes].sort((a, b) => a.position - b.position);
}

// A workflow state of the team by id or name (any case); a state type (backlog,
// unstarted, started, completed, canceled) picks the team's first state of that type.
export async function resolveState(gql: Gql, teamId: string, ref: string): Promise<StateRef> {
  const states = await teamStates(gql, teamId);
  const r = lower(ref);
  const byName = bestMatches(states, [(s) => s.id === ref.trim(), (s) => lower(s.name) === r]);
  if (byName.length) return pick('status', ref, byName, (s) => `${s.name} (${s.type})`);
  const ofType = states.filter((s) => s.type === r);
  if (ofType.length) return ofType[0]!;
  return pick('status', ref, [], (s: StateRef) => s.name);
}

interface LabelRef {
  id: string;
  name: string;
  isGroup: boolean;
  team: { id: string } | null;
}

// Labels of the team and workspace labels by id or name (any case). A team label wins
// over a workspace label of the same name, as on the board.
export async function resolveLabels(gql: Gql, teamId: string, refs: string[]): Promise<string[]> {
  if (!refs.length) return [];
  const data = await gql<{ issueLabels: { nodes: LabelRef[] } }>(
    `query($team: ID!) { issueLabels(first: 250, filter: { or: [
      { team: { id: { eq: $team } } }, { team: { null: true } } ] }) {
      nodes { id name isGroup team { id } } } }`,
    { team: teamId },
  );
  const labels = data.issueLabels.nodes.filter((l) => !l.isGroup);
  return refs.map((ref) => {
    const r = lower(ref);
    const matches = bestMatches(labels, [
      (l) => l.id === ref.trim(),
      (l) => lower(l.name) === r && l.team !== null,
      (l) => lower(l.name) === r,
    ]);
    return pick('label', ref, matches, (l) => `${l.name} (id ${l.id})`).id;
  });
}

interface ProjectRef {
  id: string;
  name: string;
}

// A project by id, by name (any case), then by part of its name.
export async function resolveProject(gql: Gql, ref: string): Promise<ProjectRef> {
  const r = ref.trim();
  if (isUuid(r)) {
    const data = await gql<{ project: ProjectRef }>(
      'query($id: String!) { project(id: $id) { id name } }',
      { id: r },
    );
    return data.project;
  }
  const data = await gql<{ projects: { nodes: ProjectRef[] } }>(
    `query($q: String!) { projects(first: 250, filter: { name: { containsIgnoreCase: $q } }) {
      nodes { id name } } }`,
    { q: r },
  );
  const matches = bestMatches(data.projects.nodes, [(p) => lower(p.name) === lower(r), () => true]);
  return pick('project', ref, matches, (p) => `${p.name} (id ${p.id})`);
}

interface CycleRef {
  id: string;
  number: number;
  name: string | null;
}

// A cycle of the team by id, number, name, or "current" / "next" / "previous".
export async function resolveCycle(
  gql: Gql,
  teamId: string,
  ref: string | number,
): Promise<string> {
  const r = String(ref).trim();
  const flag = { current: 'isActive', next: 'isNext', previous: 'isPrevious' }[lower(r)];
  const condition = flag
    ? { [flag]: { eq: true } }
    : isUuid(r)
      ? { id: { eq: r } }
      : /^\d+$/.test(r)
        ? { number: { eq: Number(r) } }
        : { name: { eqIgnoreCase: r } };
  const data = await gql<{ cycles: { nodes: CycleRef[] } }>(
    `query($filter: CycleFilter!) { cycles(first: 250, filter: $filter) {
      nodes { id number name } } }`,
    { filter: { team: { id: { eq: teamId } }, ...condition } },
  );
  return pick('cycle', r, data.cycles.nodes, (c) => `${c.name ?? `Cycle ${c.number}`}`).id;
}

// The id of an issue given its id or identifier ("ENG-42").
export async function resolveIssueId(gql: Gql, ref: string): Promise<string> {
  const data = await gql<{ issue: { id: string } }>(
    'query($id: String!) { issue(id: $id) { id } }',
    {
      id: ref.trim(),
    },
  );
  return data.issue.id;
}
