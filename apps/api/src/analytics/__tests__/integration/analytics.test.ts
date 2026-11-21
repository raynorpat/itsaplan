import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { pulseRows } from '../../store';

// Read-only team analytics. Every figure is derived from the issue /
// workflow_state / issue_activity tables, so the tests build state through the
// real create/move API (which seeds the "created" and "status" activity the
// metrics read) rather than inserting rows. createTeam seeds five default
// columns, one per state type.

// Owner + team MKT with the seeded default columns. `col` maps a state type to
// its column id so a test can place an issue in a known state without hardcoding
// ids.
async function setupTeam() {
  const owner: TestUser = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.teams({ teamKey: 'MKT' }).get();
  const columns = view.data!.states;
  const col: Record<string, string> = {};
  for (const c of columns) col[c.stateType] = c.id;
  return { asOwner, owner, columns, col };
}

async function createIssue(
  asOwner: Api,
  stateId: string,
  extra: {
    title?: string;
    priority?: number;
    dueDate?: string | null;
    assigneeUserId?: string | null;
    typeId?: string | null;
  } = {},
) {
  const { title = 'Task', ...rest } = extra;
  const res = await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title, ...rest });
  if (!res.data) throw new Error(`createIssue failed with status ${res.status}`);
  return res.data;
}

// Moving an issue to another column writes a "status" activity whose toText is the
// destination column name — the signal closed/throughput metrics read.
function moveIssue(asOwner: Api, issueId: string, stateId: string) {
  return asOwner.issues({ issueId }).patch({ stateId });
}

describe('analytics', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('stats', () => {
    it('returns all-zero stats for an empty team', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).analytics.stats.get();
      expect(res.status).toBe(200);
      expect(res.data).toEqual({
        open: 0,
        inProgress: 0,
        backlog: 0,
        overdue: 0,
        unassigned: 0,
        closedLast7d: 0,
      });
    });

    it('counts open, in-progress and backlog and excludes completed/canceled', async () => {
      const { asOwner, col } = await setupTeam();
      await createIssue(asOwner, col.backlog);
      await createIssue(asOwner, col.unstarted);
      await createIssue(asOwner, col.started);
      await createIssue(asOwner, col.completed);
      await createIssue(asOwner, col.canceled);

      const res = await asOwner.teams({ teamKey: 'MKT' }).analytics.stats.get();
      expect(res.status).toBe(200);
      // open = backlog + unstarted + started; completed and canceled are excluded.
      expect(res.data).toMatchObject({ open: 3, inProgress: 1, backlog: 1 });
    });

    it('counts overdue open issues and ignores completed and no-due-date ones', async () => {
      const { asOwner, col } = await setupTeam();
      await createIssue(asOwner, col.started, { dueDate: '2000-01-01' });
      await createIssue(asOwner, col.completed, { dueDate: '2000-01-01' });
      await createIssue(asOwner, col.started);

      const res = await asOwner.teams({ teamKey: 'MKT' }).analytics.stats.get();
      expect(res.data?.overdue).toBe(1);
    });

    it('counts only open issues without an assignee as unassigned', async () => {
      const { asOwner, owner, col } = await setupTeam();
      await createIssue(asOwner, col.started, { assigneeUserId: owner.userId });
      await createIssue(asOwner, col.started);
      await createIssue(asOwner, col.completed);

      const res = await asOwner.teams({ teamKey: 'MKT' }).analytics.stats.get();
      expect(res.data?.unassigned).toBe(1);
    });

    it('counts issues moved to a completed column as closedLast7d', async () => {
      const { asOwner, col } = await setupTeam();
      const issue = await createIssue(asOwner, col.started);
      await moveIssue(asOwner, issue.id, col.completed);

      const res = await asOwner.teams({ teamKey: 'MKT' }).analytics.stats.get();
      expect(res.data?.closedLast7d).toBe(1);
    });
  });

  describe('breakdown', () => {
    it('groups by status returning every column in work-items order, empty ones included', async () => {
      const { asOwner, col } = await setupTeam();
      await createIssue(asOwner, col.backlog);
      await createIssue(asOwner, col.backlog);
      await createIssue(asOwner, col.started);

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.breakdown.get({ query: { by: 'status' } });
      expect(res.status).toBe(200);
      expect(res.data?.map((i) => i.label)).toEqual([
        'Backlog',
        'Todo',
        'In Progress',
        'Done',
        'Canceled',
      ]);
      expect(res.data?.find((i) => i.label === 'Backlog')).toMatchObject({
        count: 2,
        key: String(col.backlog),
      });
      expect(res.data?.find((i) => i.label === 'In Progress')?.count).toBe(1);
      expect(res.data?.find((i) => i.label === 'Done')?.count).toBe(0);
    });

    it('groups by priority with a labelled No-priority bucket', async () => {
      const { asOwner, col } = await setupTeam();
      await createIssue(asOwner, col.started, { priority: 2 });
      await createIssue(asOwner, col.started, { priority: 2 });
      await createIssue(asOwner, col.started, { priority: 4 });
      await createIssue(asOwner, col.started);

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.breakdown.get({ query: { by: 'priority' } });
      expect(res.status).toBe(200);
      expect(res.data?.find((i) => i.key === '2')).toMatchObject({ label: 'High', count: 2 });
      expect(res.data?.find((i) => i.key === '4')).toMatchObject({ label: 'Low', count: 1 });
      expect(res.data?.find((i) => i.key === '0')).toMatchObject({
        label: 'No priority',
        count: 1,
      });
    });

    it('groups by type with a No-type bucket', async () => {
      const { asOwner, col } = await setupTeam();
      const type = await asOwner.teams({ teamKey: 'MKT' })['issue-types'].post({ name: 'Bug' });
      await createIssue(asOwner, col.started, { typeId: type.data!.id });
      await createIssue(asOwner, col.started);

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.breakdown.get({ query: { by: 'type' } });
      expect(res.status).toBe(200);
      expect(res.data?.find((i) => i.key === String(type.data!.id))).toMatchObject({
        label: 'Bug',
        count: 1,
      });
      expect(res.data?.find((i) => i.key === 'none')).toMatchObject({ label: 'No type', count: 1 });
    });

    it('groups by assignee with an Unassigned bucket', async () => {
      const { asOwner, owner, col } = await setupTeam();
      await createIssue(asOwner, col.started, { assigneeUserId: owner.userId });
      await createIssue(asOwner, col.started);

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.breakdown.get({ query: { by: 'assignee' } });
      expect(res.status).toBe(200);
      expect(res.data?.find((i) => i.key === owner.userId)).toMatchObject({
        label: 'Owner',
        count: 1,
      });
      expect(res.data?.find((i) => i.key === 'none')).toMatchObject({
        label: 'Unassigned',
        count: 1,
      });
    });

    it('groups by delegate with a Not-delegated bucket', async () => {
      const { asOwner, col } = await setupTeam();
      const agent = await createAgent(asOwner, 'helperbot');
      const delegated = await createIssue(asOwner, col.started);
      await asOwner.issues({ issueId: delegated.id }).patch({ delegateUserId: agent.userId });
      await createIssue(asOwner, col.started);

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.breakdown.get({ query: { by: 'delegate' } });
      expect(res.status).toBe(200);
      expect(res.data?.find((i) => i.key === agent.userId)).toMatchObject({
        label: 'helperbot',
        count: 1,
      });
      expect(res.data?.find((i) => i.key === 'none')).toMatchObject({
        label: 'Not delegated',
        count: 1,
      });
    });

    it('rejects an unknown group-by value', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.breakdown.get({ query: { by: 'nonsense' as unknown as 'status' } });
      expect(res.status).toBe(400);
    });
  });

  describe('pulse', () => {
    it('counts comments', async () => {
      const { asOwner, col } = await setupTeam();
      const issue = await createIssue(asOwner, col.started!);
      const total = async () =>
        (await asOwner.teams({ teamKey: 'MKT' }).analytics.pulse.get()).data!.reduce(
          (sum, c) => sum + c.count,
          0,
        );
      const before = await total();
      await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'hi' });
      expect(await total()).toBe(before + 1);
    });

    it('returns a zero-filled default day series for an empty team', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).analytics.pulse.get();
      expect(res.status).toBe(200);
      // Default: 26 day columns of 7 cells each, all zero.
      expect(res.data).toHaveLength(26 * pulseRows('day'));
      expect(res.data?.every((b) => b.count === 0)).toBe(true);
      expect(typeof res.data?.[0].label).toBe('string');
    });

    it('reflects activity in the series', async () => {
      const { asOwner, col } = await setupTeam();
      await createIssue(asOwner, col.started);

      const res = await asOwner.teams({ teamKey: 'MKT' }).analytics.pulse.get();
      const total = res.data?.reduce((sum, b) => sum + b.count, 0);
      // The one "created" activity lands in the current bucket.
      expect(total).toBe(1);
    });

    it('honors unit and columns', async () => {
      const { asOwner } = await setupTeam();
      const hour = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.pulse.get({ query: { unit: 'hour', columns: 2 } });
      expect(hour.data).toHaveLength(2 * pulseRows('hour'));

      const week = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.pulse.get({ query: { unit: 'week', columns: 5 } });
      expect(week.data).toHaveLength(5 * pulseRows('week'));
    });

    it("clamps columns to the unit's bounds", async () => {
      const { asOwner } = await setupTeam();
      const tooMany = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.pulse.get({ query: { unit: 'day', columns: 10000 } });
      expect(tooMany.data).toHaveLength(160 * pulseRows('day'));

      const tooFew = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.pulse.get({ query: { unit: 'day', columns: 0 } });
      expect(tooFew.data).toHaveLength(1 * pulseRows('day'));
    });

    it('rejects an unknown unit', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.pulse.get({ query: { unit: 'nonsense' as unknown as 'day' } });
      expect(res.status).toBe(400);
    });
  });

  describe('throughput', () => {
    it('returns an empty series for a team with no activity', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).analytics.throughput.get();
      expect(res.status).toBe(200);
      expect(res.data).toEqual([]);
    });

    it('counts created and closed issues in the current week', async () => {
      const { asOwner, col } = await setupTeam();
      const a = await createIssue(asOwner, col.started);
      await createIssue(asOwner, col.started);
      await moveIssue(asOwner, a.id, col.completed);

      const res = await asOwner.teams({ teamKey: 'MKT' }).analytics.throughput.get();
      expect(res.status).toBe(200);
      expect(res.data).toHaveLength(1);
      expect(res.data?.[0]).toMatchObject({ created: 2, closed: 1 });
    });
  });

  describe('activity', () => {
    it('returns the feed with issue context, newest first', async () => {
      const { asOwner, col } = await setupTeam();
      await createIssue(asOwner, col.backlog, { title: 'Alpha' });

      const res = await asOwner.teams({ teamKey: 'MKT' }).analytics.activity.get();
      expect(res.status).toBe(200);
      expect(res.data?.items).toHaveLength(1);
      expect(res.data?.items[0]).toMatchObject({
        action: 'created',
        kind: 'activity',
        issueTitle: 'Alpha',
      });
      expect(typeof res.data?.items[0].issueSequence).toBe('number');
      expect(res.data?.nextCursor).toBeNull();
    });

    it('paginates with the keyset cursor', async () => {
      const { asOwner, col } = await setupTeam();
      await createIssue(asOwner, col.started);
      await createIssue(asOwner, col.started);
      await createIssue(asOwner, col.started);

      const first = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.activity.get({ query: { limit: 2 } });
      expect(first.data?.items).toHaveLength(2);
      expect(first.data?.nextCursor).not.toBeNull();

      const second = await asOwner.teams({ teamKey: 'MKT' }).analytics.activity.get({
        query: { limit: 2, cursor: JSON.stringify(first.data!.nextCursor) },
      });
      expect(second.data?.items).toHaveLength(1);
      expect(second.data?.nextCursor).toBeNull();

      const firstIds = first.data!.items.map((i) => i.id);
      const secondIds = second.data!.items.map((i) => i.id);
      expect(firstIds).not.toContain(secondIds[0]);
    });

    it('filters by action', async () => {
      const { asOwner, col } = await setupTeam();
      const issue = await createIssue(asOwner, col.started);
      await moveIssue(asOwner, issue.id, col.completed);

      const status = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.activity.get({ query: { action: 'status' } });
      expect(status.data?.items).toHaveLength(1);
      expect(status.data?.items[0]).toMatchObject({ action: 'status', toText: 'Done' });

      const created = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.activity.get({ query: { action: 'created' } });
      expect(created.data?.items).toHaveLength(1);
      expect(created.data?.items[0]?.action).toBe('created');
    });

    it('filters by actor', async () => {
      const { asOwner, owner, col } = await setupTeam();
      // The "created" activity is attributed to the session user who created it.
      await createIssue(asOwner, col.started);

      const mine = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.activity.get({ query: { actorUserId: owner.userId } });
      expect(mine.data?.items.length).toBeGreaterThan(0);
      expect(mine.data?.items.every((i) => i.actorUserId === owner.userId)).toBe(true);

      const other = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.activity.get({ query: { actorUserId: '00000000-0000-4000-8000-000000000000' } });
      expect(other.data?.items).toHaveLength(0);
    });

    it('filters by issue ids and returns nothing for a filter with no valid ids', async () => {
      const { asOwner, col } = await setupTeam();
      const a = await createIssue(asOwner, col.started);
      await createIssue(asOwner, col.started);

      const scoped = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.activity.get({ query: { issueIds: String(a.id) } });
      expect(scoped.data?.items.length).toBeGreaterThan(0);
      expect(scoped.data?.items.every((i) => i.issueId === a.id)).toBe(true);

      const none = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.activity.get({ query: { issueIds: 'abc' } });
      expect(none.data?.items).toHaveLength(0);
    });

    it('clamps a limit below 1 up to a single item', async () => {
      const { asOwner, col } = await setupTeam();
      await createIssue(asOwner, col.started);
      await createIssue(asOwner, col.started);

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.activity.get({ query: { limit: 0 } });
      expect(res.status).toBe(200);
      // limit 0 is clamped to 1, so the page holds one item and reports more.
      expect(res.data?.items).toHaveLength(1);
      expect(res.data?.nextCursor).not.toBeNull();
    });

    it('ignores a malformed cursor and serves the first page', async () => {
      const { asOwner, col } = await setupTeam();
      await createIssue(asOwner, col.started);
      await createIssue(asOwner, col.started);

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .analytics.activity.get({ query: { cursor: 'not-json' } });
      expect(res.status).toBe(200);
      expect(res.data?.items).toHaveLength(2);
    });
  });

  // Creates an agent (external by default) and returns its bot user id, so a test
  // can delegate an issue to it or assert the workload roster.
  async function createAgent(
    asOwner: Api,
    username: string,
    kind: 'external' | 'internal' = 'external',
  ) {
    const res = await asOwner
      .teams({ teamKey: 'MKT' })
      ['ai-agents'].post({ name: username, username, kind });
    if (!res.data) throw new Error(`createAgent failed with status ${res.status}`);
    return res.data.agent;
  }

  describe('agent runs', () => {
    it('returns an empty feed for a team with no runs', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' })['analytics']['agent-runs'].get();
      expect(res.status).toBe(200);
      expect(res.data).toEqual([]);
    });

    it('accepts a status filter', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        ['analytics']['agent-runs'].get({ query: { status: 'failed' } });
      expect(res.status).toBe(200);
      expect(res.data).toEqual([]);
    });

    it('rejects an unknown status', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        ['analytics']['agent-runs'].get({ query: { status: 'nonsense' as unknown as 'failed' } });
      expect(res.status).toBe(400);
    });
  });

  describe('agent run stats', () => {
    it('returns all-zero counts for a team with no runs', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' })['analytics']['agent-run-stats'].get();
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ total: 0, success: 0, failed: 0, pending: 0 });
    });
  });

  describe('webhook stats', () => {
    it('returns all-zero counts for a team with no webhooks', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' })['analytics']['webhook-stats'].get();
      expect(res.status).toBe(200);
      expect(res.data).toEqual({
        total: 0,
        success: 0,
        failed: 0,
        pending: 0,
        activeWebhooks: 0,
        disabledWebhooks: 0,
      });
    });

    it('reflects the active and disabled subscription split', async () => {
      const { asOwner } = await setupTeam();
      const scope = asOwner.teams({ teamKey: 'MKT' });
      const active = await scope.webhooks.post({
        url: 'https://example.com/a',
        resourceTypes: ['Issue'],
      });
      await scope.webhooks.post({ url: 'https://example.com/b', resourceTypes: ['Issue'] });
      // Disable one so the counts split.
      await asOwner.webhooks({ webhookId: active.data!.id }).patch({ enabled: false });

      const res = await scope['analytics']['webhook-stats'].get();
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ activeWebhooks: 1, disabledWebhooks: 1 });
    });
  });

  describe('agent workload', () => {
    it('returns an empty roster for a team with no agents', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' })['analytics']['agent-workload'].get();
      expect(res.status).toBe(200);
      expect(res.data).toEqual([]);
    });

    it('counts open issues delegated to an agent and reports zero runs', async () => {
      const { asOwner, col } = await setupTeam();
      const agent = await createAgent(asOwner, 'helperbot');
      const issue = await createIssue(asOwner, col.started);
      await asOwner.issues({ issueId: issue.id }).patch({ delegateUserId: agent.userId });

      const res = await asOwner.teams({ teamKey: 'MKT' })['analytics']['agent-workload'].get();
      expect(res.status).toBe(200);
      const row = res.data?.find((r) => r.agentId === agent.id);
      expect(row).toMatchObject({
        agentName: 'helperbot',
        delegatedOpen: 1,
        runsTotal: 0,
        runsSuccess: 0,
        runsFailed: 0,
      });
    });

    it('excludes completed and canceled issues from the delegated count', async () => {
      const { asOwner, col } = await setupTeam();
      const agent = await createAgent(asOwner, 'helperbot');
      const open = await createIssue(asOwner, col.started);
      const done = await createIssue(asOwner, col.completed);
      await asOwner.issues({ issueId: open.id }).patch({ delegateUserId: agent.userId });
      await asOwner.issues({ issueId: done.id }).patch({ delegateUserId: agent.userId });

      const res = await asOwner.teams({ teamKey: 'MKT' })['analytics']['agent-workload'].get();
      const row = res.data?.find((r) => r.agentId === agent.id);
      expect(row?.delegatedOpen).toBe(1);
    });
  });

  describe('access', () => {
    it('returns 404 for an unknown team', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'NOPE' }).analytics.stats.get();
      expect(res.status).toBe(404);
    });

    it('denies a non-member on every analytics route', async () => {
      await setupTeam();
      const outsider = authedApi((await signUpTestUser()).cookie);
      const scope = outsider.teams({ teamKey: 'MKT' });

      // Guard-thrown 403 is not in Treaty's inferred error-status union, so assert
      // the top-level HTTP status rather than error.status.
      expect((await scope.analytics.stats.get()).status).toBe(403);
      expect((await scope.analytics.breakdown.get({ query: { by: 'status' } })).status).toBe(403);
      expect((await scope.analytics.pulse.get()).status).toBe(403);
      expect((await scope.analytics.throughput.get()).status).toBe(403);
      expect((await scope.analytics.activity.get()).status).toBe(403);
      expect((await scope['analytics']['agent-runs'].get()).status).toBe(403);
      expect((await scope['analytics']['agent-run-stats'].get()).status).toBe(403);
      expect((await scope['analytics']['webhook-stats'].get()).status).toBe(403);
      expect((await scope['analytics']['agent-workload'].get()).status).toBe(403);
    });
  });
});
