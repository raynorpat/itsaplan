import { beforeEach, describe, expect, it } from 'bun:test';
import { auditEntry, db, project } from '@repo/db';
import { asc, eq } from 'drizzle-orm';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createProject,
  createTeam,
  gqlData,
  signUpAs,
} from '../../../__tests__/helpers/graphql';
import { ORIGIN } from '../../../__tests__/helpers/oauth';
import { createImport, setImportStatus } from '../../../imports/store';
import { recordAudit } from '../../store';

// Data events and exports: deleting, merging, importing and exporting data each leave an
// audit entry naming the affected item, and the audit log itself exports as CSV.

type Row = typeof auditEntry.$inferSelect;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function rows(type: string): Promise<Row[]> {
  return db
    .select()
    .from(auditEntry)
    .where(eq(auditEntry.type, type))
    .orderBy(asc(auditEntry.createdAt));
}

async function only(type: string): Promise<Row> {
  const found = await rows(type);
  expect(found).toHaveLength(1);
  return found[0]!;
}

const meta = (row: Row) => (row.metadata ?? {}) as Json;

function instance(path: string, as: TestUser, body?: unknown): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN, cookie: as.cookie });
  if (body !== undefined) headers.set('content-type', 'application/json');
  return app.handle(
    new Request(`http://localhost/api/auth/instance/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function ok(res: Response): Promise<Json> {
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

let owner: TestUser;
let member: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await signUpTestUser({ name: 'Olive Owner' });
  member = await signUpTestUser({ name: 'Mo Member' });
});

describe('imports', () => {
  it('records an import starting, finishing and failing', async () => {
    const eng = await createTeam(owner, { name: 'Engineering', key: 'ENG' });
    const job = await createImport({
      service: 'csv',
      teamId: eng.team.id,
      creatorId: owner.userId,
      displayName: 'export.csv',
      serviceMetadata: {},
    });
    const started = await only('importStarted');
    expect(started.actorId).toBe(owner.userId);
    expect(meta(started)).toMatchObject({
      entityType: 'issueImport',
      entityId: job.id,
      service: 'csv',
      teamId: eng.team.id,
    });

    await setImportStatus(job.id, 'complete', {
      summary: {
        issues: 3,
        skippedExisting: 1,
        comments: 2,
        labelsCreated: 0,
        total: 4,
        skipped: [],
      },
    });
    expect(meta(await only('importCompleted'))).toMatchObject({
      entityId: job.id,
      issues: 3,
      skippedExisting: 1,
    });

    const other = await createImport({
      service: 'csv',
      teamId: eng.team.id,
      creatorId: owner.userId,
      displayName: 'other.csv',
      serviceMetadata: {},
    });
    await setImportStatus(other.id, 'error', { error: 'The team is gone' });
    expect(meta(await only('importFailed'))).toMatchObject({
      entityId: other.id,
      error: 'The team is gone',
    });
  });

  it('records a failed import once, however often its status is set to error', async () => {
    const eng = await createTeam(owner, { name: 'Engineering', key: 'ENG' });
    const job = await createImport({
      service: 'csv',
      teamId: eng.team.id,
      creatorId: owner.userId,
      displayName: 'export.csv',
      serviceMetadata: {},
    });
    await setImportStatus(job.id, 'error', { error: 'First' });
    await setImportStatus(job.id, 'error', { error: 'Second' });
    expect(await rows('importFailed')).toHaveLength(1);
  });

  it('records nothing for an import that is only moving along', async () => {
    const eng = await createTeam(owner, { name: 'Engineering', key: 'ENG' });
    const job = await createImport({
      service: 'csv',
      teamId: eng.team.id,
      creatorId: owner.userId,
      displayName: 'export.csv',
      serviceMetadata: {},
    });
    await setImportStatus(job.id, 'inProcess');
    expect(await rows('importCompleted')).toEqual([]);
    expect(await rows('importFailed')).toEqual([]);
  });
});

describe('deletions', () => {
  it('records a project deleted and later purged', async () => {
    const eng = await createTeam(owner, { name: 'Engineering', key: 'ENG' });
    const made = await createProject(owner, { name: 'Billing', teamIds: [eng.team.id] });
    await gqlData(owner, `mutation { projectDelete(id: "${made.id}") { success } }`);
    const deleted = await only('projectDeleted');
    expect(deleted.actorId).toBe(owner.userId);
    expect(meta(deleted)).toMatchObject({
      entityType: 'project',
      entityId: made.id,
      entityIdentifier: made.slugId,
      name: 'Billing',
    });

    await db
      .update(project)
      .set({ archivedAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(project.id, made.id));
    const previous = process.env.WORKER_INTERNAL_TOKEN;
    process.env.WORKER_INTERNAL_TOKEN = 'test-worker-token';
    try {
      const res = await app.handle(
        new Request('http://localhost/internal/projects/purge', {
          method: 'POST',
          headers: { 'x-worker-token': 'test-worker-token' },
        }),
      );
      expect(res.status).toBe(200);
    } finally {
      process.env.WORKER_INTERNAL_TOKEN = previous;
    }
    const purged = await only('projectPurged');
    expect(purged.requestInformation).toMatchObject({ method: 'worker' });
    expect(purged.actorId).toBeNull();
    expect(meta(purged)).toMatchObject({ entityId: made.id, name: 'Billing' });
  });

  it('records an issue deleted with its identifier, never its content', async () => {
    const eng = await createTeam(owner, { name: 'Engineering', key: 'ENG' });
    const made = await createIssue(owner, {
      teamId: eng.team.id,
      title: 'Leaked roadmap',
      description: 'secret plan',
    });
    await gqlData(
      owner,
      `mutation { issueDelete(id: "${made.id}", permanentlyDelete: true) { success } }`,
    );
    const deleted = await only('issueDeleted');
    expect(meta(deleted)).toMatchObject({
      entityType: 'issue',
      entityId: made.id,
      entityIdentifier: 'ENG-1',
    });
    const raw = JSON.stringify(deleted);
    expect(raw).not.toContain('Leaked roadmap');
    expect(raw).not.toContain('secret plan');
  });

  it('records a dashboard deleted', async () => {
    const made = (
      await ok(
        await instance('dashboards/create', member, {
          name: 'Delivery',
          sharedWith: 'workspace',
          widgets: [],
        }),
      )
    ).dashboard as Json;
    await ok(await instance('dashboards/delete', member, { id: made.id }));
    const deleted = await only('dashboardDeleted');
    expect(deleted.actorId).toBe(member.userId);
    expect(meta(deleted)).toMatchObject({
      entityType: 'dashboard',
      entityId: made.id,
      name: 'Delivery',
    });
  });
});

describe('customers and requesters', () => {
  async function customer(name: string): Promise<string> {
    const data = await gqlData(
      owner,
      `mutation($name: String!) { customerCreate(input: { name: $name }) { customer { id } } }`,
      { name },
    );
    return data.customerCreate.customer.id as string;
  }

  it('records customers deleted and merged', async () => {
    await ok(await instance('customers-settings/save', owner, { enabled: true }));
    const acme = await customer('Acme');
    const globex = await customer('Globex');
    const initech = await customer('Initech');
    await gqlData(
      owner,
      `mutation { customerMerge(sourceCustomerId: "${acme}", targetCustomerId: "${globex}") { success } }`,
    );
    expect(meta(await only('customerMerged'))).toMatchObject({
      entityType: 'customer',
      entityId: globex,
      sourceId: acme,
      sourceName: 'Acme',
      name: 'Globex',
    });
    await gqlData(owner, `mutation { customerDelete(id: "${initech}") { success } }`);
    expect(meta(await only('customerDeleted'))).toMatchObject({
      entityType: 'customer',
      entityId: initech,
      name: 'Initech',
    });
  });

  it('records requesters merged, without their email addresses', async () => {
    const a = (
      await ok(
        await instance('requesters/create', owner, { name: 'Ann', email: 'ann@example.com' }),
      )
    ).requester as Json;
    const b = (
      await ok(
        await instance('requesters/create', owner, { name: 'Bea', email: 'bea@example.com' }),
      )
    ).requester as Json;
    await ok(await instance('requesters/merge', owner, { fromId: a.id, intoId: b.id }));
    const merged = await only('requesterMerged');
    expect(meta(merged)).toMatchObject({
      entityType: 'requester',
      entityId: b.id,
      sourceId: a.id,
      name: 'Bea',
      sourceName: 'Ann',
    });
    expect(JSON.stringify(merged)).not.toContain('@example.com');
  });
});

describe('portal and forms', () => {
  it('records portal boards created, changed and deleted', async () => {
    const eng = await createTeam(owner, { name: 'Engineering', key: 'ENG' });
    const board = (
      await ok(
        await instance('portal/boards/create', owner, {
          slug: 'roadmap',
          name: 'Roadmap',
          teamId: eng.team.id,
        }),
      )
    ).board as Json;
    expect(meta(await only('portalBoardCreated'))).toMatchObject({
      entityType: 'portalBoard',
      entityId: board.id,
      entityIdentifier: 'roadmap',
      name: 'Roadmap',
    });
    await ok(await instance('portal/boards/update', owner, { id: board.id, access: 'restricted' }));
    expect(meta(await only('portalBoardUpdated'))).toMatchObject({
      entityId: board.id,
      changes: { access: { from: 'public', to: 'restricted' } },
    });
    await ok(await instance('portal/boards/delete', owner, { id: board.id }));
    expect(meta(await only('portalBoardDeleted'))).toMatchObject({
      entityId: board.id,
      name: 'Roadmap',
    });
  });

  it('records a requester blocked and unblocked', async () => {
    const person = (
      await ok(
        await instance('requesters/create', owner, { name: 'Sam', email: 'sam@example.com' }),
      )
    ).requester as Json;
    await ok(await instance('portal/block', owner, { requesterId: person.id, blocked: true }));
    expect((await only('requesterBlocked')).actorId).toBe(owner.userId);
    expect(meta(await only('requesterBlocked'))).toMatchObject({
      entityType: 'requester',
      entityId: person.id,
      name: 'Sam',
    });
    await ok(await instance('portal/block', owner, { requesterId: person.id, blocked: false }));
    expect(meta(await only('requesterUnblocked'))).toMatchObject({ entityId: person.id });
    expect((await only('requesterUnblocked')).actorId).toBe(owner.userId);
  });

  it("records a form's settings changed", async () => {
    const eng = await createTeam(owner, { name: 'Engineering', key: 'ENG' });
    const template = (
      await gqlData(
        owner,
        `mutation($input: TemplateCreateInput!) { templateCreate(input: $input) { template { id } } }`,
        {
          input: {
            type: 'issue',
            name: 'Bug report',
            teamId: eng.team.id,
            templateData: {
              title: 'Bug',
              formFields: [{ id: 'what', type: 'shortText', label: 'What', role: 'title' }],
            },
          },
        },
      )
    ).templateCreate.template as { id: string };
    await ok(
      await instance('forms/settings', owner, {
        templateId: template.id,
        slug: 'bugs',
        linkEnabled: true,
      }),
    );
    const saved = await only('formSettingsChanged');
    expect(meta(saved)).toMatchObject({
      entityType: 'form',
      entityId: template.id,
      entityIdentifier: 'bugs',
      name: 'Bug report',
    });
  });
});

describe('exports', () => {
  it('exports the filtered audit log as CSV and records it', async () => {
    const quoted = await signUpTestUser({ name: '=1+1' });
    await recordAudit('teamCreated', { name: 'Ops, "Night"' }, { actorId: quoted.userId });
    const res = await instance('audit/export', owner, { type: 'teamCreated' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('Date,Type,Actor,Actor email,IP,Country,Method,Details');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=1+1"`);
    // The details cell is the metadata as JSON, quoted for CSV (quotes doubled).
    const details = JSON.stringify({ name: 'Ops, "Night"' });
    expect(lines[1]).toContain(`"${details.replace(/"/g, '""')}"`);

    const exported = await only('dataExported');
    expect(exported.actorId).toBe(owner.userId);
    expect(meta(exported)).toMatchObject({
      kind: 'auditLog',
      rows: 1,
      filters: { type: 'teamCreated' },
    });
  });

  it('refuses the audit export to members', async () => {
    expect((await instance('audit/export', member, {})).status).toBe(403);
    expect(await rows('dataExported')).toEqual([]);
  });

  it('exports only by POST with a trusted Origin', async () => {
    expect((await instance('audit/export', owner)).status).not.toBe(200);
    const noOrigin = await app.handle(
      new Request('http://localhost/api/auth/instance/audit/export', {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(noOrigin.status).toBe(403);
    expect(await rows('dataExported')).toEqual([]);
  });

  it('exports every entry newest first across batches', async () => {
    for (let i = 0; i < 1200; i += 1)
      await recordAudit('teamCreated', { name: `T${i}` }, { actorId: owner.userId });
    const res = await instance('audit/export', owner, { type: 'teamCreated' });
    const lines = (await res.text()).trim().split('\r\n');
    expect(lines).toHaveLength(1201);
    expect(lines[1]).toContain('T1199');
    expect(lines[1200]).toContain('T0');
  });

  it('records a dashboard CSV download reported by the web', async () => {
    await ok(
      await instance('audit/export-recorded', member, {
        kind: 'widget',
        id: 'w1',
        name: 'Requests per week',
        rows: 12,
      }),
    );
    const exported = await only('dataExported');
    expect(exported.actorId).toBe(member.userId);
    expect(meta(exported)).toMatchObject({
      kind: 'widget',
      entityId: 'w1',
      name: 'Requests per week',
      rows: 12,
    });
  });

  it('refuses export reports from guests and bad kinds', async () => {
    const guest = await signUpAs('guest');
    const report = { kind: 'dashboard', id: 'd1', name: 'D', rows: 1 };
    expect((await instance('audit/export-recorded', guest, report)).status).toBe(403);
    const bad = await instance('audit/export-recorded', member, { ...report, kind: 'everything' });
    expect(bad.status).toBe(400);
    expect(await rows('dataExported')).toEqual([]);
  });
});
