import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { attachment, db, fileUpload, issue, issueImportSource } from '@repo/db';
import { and, asc, eq } from 'drizzle-orm';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createState,
  createTeam,
  gqlData,
  signUpAs,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { putObject } from '../../../shared/s3';
import { uploadIdFromAssetUrl } from '../../../uploads/store';
import { processImport } from '../../engine';
import { expireWaitingImports, isAwaitingPeople } from '../../flow';
import { getImport, sweepInterruptedImports, type ImportRow } from '../../store';

// CSV imports end to end: a Jira export through Linear's issueImportCheckCSV /
// issueImportCreateCSVJira / issueImportProcess, a generic CSV through the Import page's
// endpoints, re-runs by source key, and the import file's lifetime.

let storeAvailable = false;
beforeAll(async () => {
  storeAvailable = await Promise.race([
    putObject('healthcheck/csv-import-test', Buffer.from('ok'), 'text/plain').then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
  ]);
});

const ORIGIN = process.env.APP_URL ?? 'http://localhost:3001';

const JIRA = [
  'Summary,Issue key,Issue id,Status,Priority,Assignee,Reporter,Created,Resolved,Labels,Labels,Description,Comment,Custom field (Story Points)',
  'Export to CSV,ENG-1,10001,Done,Highest,Ann Lee,Bob Ray,01/Feb/24 10:15 AM,03/Feb/24 9:00 AM,export,bug,"h2. Why\n*Customers* ask",02/Feb/24 11:00 AM;Bob Ray;Please hurry,5',
  'Dark mode,ENG-2,10002,In Review,Low,,Bob Ray,05/Feb/24 2:00 PM,,ui,,,,3',
  "Old idea,ENG-3,10003,Won't Do,Medium,,,06/Feb/24 8:00 AM,,,,,,",
].join('\n');

const GENERIC = [
  'Name,State,Tags,Due,Ref',
  'Write docs,Backlog,docs,03/04/2026,7',
  'Ship it,Shipped,,,8',
  ',Backlog,,,',
].join('\n');

let owner: TestUser;
let teamId: string;
let states: Record<string, string>;

async function upload(who: TestUser, text: string, name = 'export.csv'): Promise<string> {
  const res = await gqlData(
    who,
    `mutation($size: Int!) {
       fileUpload(contentType: "text/csv", filename: "${name}", size: $size,
         metaData: { purpose: "import" }) {
         uploadFile { uploadUrl assetUrl contentType }
       }
     }`,
    { size: Buffer.byteLength(text) },
  );
  const file = res.fileUpload.uploadFile as { uploadUrl: string; assetUrl: string };
  const put = await app.handle(
    new Request(`http://localhost${new URL(file.uploadUrl).pathname}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/csv' },
      body: text,
    }),
  );
  expect(put.status).toBe(200);
  return file.assetUrl;
}

function plugin(who: TestUser, path: string, body: unknown) {
  return app.handle(
    new Request(`http://localhost/api/auth${path}`, {
      method: 'POST',
      headers: { cookie: who.cookie, 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(body),
    }),
  );
}

async function waitFor(id: string, done: (row: ImportRow) => boolean): Promise<ImportRow> {
  for (let i = 0; i < 300; i += 1) {
    const row = (await getImport(id))!;
    if (done(row)) return row;
    await Bun.sleep(20);
  }
  throw new Error('The import did not reach the expected state');
}

const teamIssues = () =>
  db.select().from(issue).where(eq(issue.teamId, teamId)).orderBy(asc(issue.sequenceNumber));

const uploadRow = async (assetUrl: string) =>
  (
    await db
      .select()
      .from(fileUpload)
      .where(eq(fileUpload.id, uploadIdFromAssetUrl(assetUrl)!))
  )[0];

beforeEach(async () => {
  await resetDb();
  owner = await signUpTestUser({ name: 'Owner' });
  teamId = (await createTeam(owner, { key: 'ENG', name: 'Engineering' })).team.id;
  const res = await gqlData(
    owner,
    `query($id: String!) { team(id: $id) { states { nodes { id name type } } } }`,
    { id: teamId },
  );
  states = Object.fromEntries(
    (res.team.states.nodes as { id: string; name: string }[]).map((s) => [s.name, s.id]),
  );
});

describe('Jira CSV through Linear operations', () => {
  it('checks the file, then imports it with the status mapping', async () => {
    if (!storeAvailable) return;
    const url = await upload(owner, JIRA);
    const check = await gqlData(
      owner,
      `query($url: String!) { issueImportCheckCSV(csvUrl: $url, service: "jira") { success } }`,
      { url },
    );
    expect(check.issueImportCheckCSV.success).toBe(true);

    const created = await gqlData(
      owner,
      `mutation($url: String!, $team: String!) {
         issueImportCreateCSVJira(csvUrl: $url, teamId: $team, jiraHostname: "acme.atlassian.net",
           jiraToken: "unused") {
           issueImport { id service status serviceMetadata csvFileUrl }
         }
       }`,
      { url, team: teamId },
    );
    const job = created.issueImportCreateCSVJira.issueImport;
    expect(job.service).toBe('jira');
    expect(job.serviceMetadata.statuses).toEqual(['Done', 'In Review', "Won't Do"]);
    expect(job.csvFileUrl).toBe(url);
    await waitFor(job.id, isAwaitingPeople);
    // The file is kept while the import waits.
    expect((await uploadRow(url))?.usedAt).not.toBeNull();

    const processed = await gqlData(
      owner,
      `mutation($id: String!, $mapping: JSONObject!) {
         issueImportProcess(issueImportId: $id, mapping: $mapping) { success }
       }`,
      { id: job.id, mapping: { people: {}, statuses: { 'In Review': 'In Progress' } } },
    );
    expect(processed.issueImportProcess.success).toBe(true);
    const done = await waitFor(job.id, (r) => r.status === 'complete' || r.status === 'error');
    expect(done.error).toBeNull();

    const rows = await teamIssues();
    expect(rows.map((r) => r.title)).toEqual(['Export to CSV', 'Dark mode', 'Old idea']);
    const [first, second, third] = rows;
    expect(first!.stateId).toBe(states.Done!);
    expect(first!.priority).toBe(1);
    expect(first!.completedAt?.toISOString()).toBe('2024-02-03T09:00:00.000Z');
    expect(first!.createdAt.toISOString()).toBe('2024-02-01T10:15:00.000Z');
    expect(first!.description).toContain('## Why');
    expect(first!.description).toContain('**Customers** ask');
    // Estimates are off for the team: the Story Points are left empty and counted.
    expect(first!.estimate).toBeNull();
    expect(second!.stateId).toBe(states['In Progress']!);
    expect(third!.stateId).toBe(states.Canceled!);
    const [link] = await db.select().from(attachment).where(eq(attachment.issueId, first!.id));
    expect(link!.url).toBe('https://acme.atlassian.net/browse/ENG-1');
    expect(link!.title).toBe('Jira ENG-1');
    const summary = done.summary as {
      issues: number;
      comments: number;
      counts: { badEstimate: number };
    };
    expect(summary.issues).toBe(3);
    expect(summary.comments).toBe(1);
    expect(summary.counts.badEstimate).toBe(2);
    // The file is deleted once the import ends.
    expect(await uploadRow(url)).toBeUndefined();
  });

  it('refuses a file that is not a Jira export', async () => {
    if (!storeAvailable) return;
    const url = await upload(owner, GENERIC);
    const res = await gql(
      { cookie: owner.cookie },
      `query($url: String!) { issueImportCheckCSV(csvUrl: $url, service: "jira") { success } }`,
      { url },
    );
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
    expect(res.body.errors?.[0]?.message).toContain(
      'The file is not a Jira CSV export (no Summary column)',
    );
  });

  it('lets only owners and admins import', async () => {
    if (!storeAvailable) return;
    const url = await upload(owner, JIRA);
    const member = await signUpAs('member');
    const res = await gql(
      { cookie: member.cookie },
      `mutation($url: String!, $team: String!) {
         issueImportCreateCSVJira(csvUrl: $url, teamId: $team) { success }
       }`,
      { url, team: teamId },
    );
    expect(res.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  it('uses the mapping saved with issueImportUpdate', async () => {
    if (!storeAvailable) return;
    const url = await upload(owner, JIRA);
    const created = await gqlData(
      owner,
      `mutation($url: String!, $team: String!) {
         issueImportCreateCSVJira(csvUrl: $url, teamId: $team) { issueImport { id } }
       }`,
      { url, team: teamId },
    );
    const id = created.issueImportCreateCSVJira.issueImport.id as string;
    await waitFor(id, isAwaitingPeople);
    await gqlData(
      owner,
      `mutation($id: String!, $mapping: JSONObject!) {
         issueImportUpdate(id: $id, input: { mapping: $mapping }) { success }
       }`,
      { id, mapping: { statuses: { Done: 'Backlog' } } },
    );
    await gqlData(
      owner,
      `mutation($id: String!) { issueImportProcess(issueImportId: $id, mapping: {}) { success } }`,
      { id },
    );
    await waitFor(id, (r) => r.status === 'complete');
    const [first] = await teamIssues();
    expect(first!.stateId).toBe(states.Backlog!);
  });
});

describe('generic CSV through the Import page', () => {
  it('previews, then imports with the confirmed columns', async () => {
    if (!storeAvailable) return;
    const url = await upload(owner, GENERIC, 'tasks.csv');
    const preview = await plugin(owner, '/instance/imports/csv/preview', { assetUrl: url });
    expect(preview.status).toBe(200);
    const view = (await preview.json()) as {
      headers: string[];
      guess: Record<string, unknown>;
      jira: boolean;
      rows: number;
    };
    expect(view.headers).toEqual(['Name', 'State', 'Tags', 'Due', 'Ref']);
    expect(view.jira).toBe(false);
    expect(view.rows).toBe(3);
    expect(view.guess).toMatchObject({ title: 0, status: 1, labels: 2, dueDate: 3, id: 4 });

    const create = await plugin(owner, '/instance/imports/csv/create', {
      assetUrl: url,
      source: 'generic',
      mapping: { ...view.guess, dateFormat: 'dayFirst' },
      teamId,
    });
    expect(create.status).toBe(200);
    const { import: job } = (await create.json()) as {
      import: { id: string; displayName: string; serviceMetadata: { statuses: string[] } };
    };
    expect(job.displayName).toBe('tasks.csv');
    expect(job.serviceMetadata.statuses).toEqual(['Backlog', 'Shipped']);
    await waitFor(job.id, isAwaitingPeople);
    const process = await plugin(owner, '/instance/imports/process', {
      id: job.id,
      people: {},
      statuses: { Shipped: states.Done },
    });
    expect(process.status).toBe(200);
    const done = await waitFor(job.id, (r) => r.status === 'complete');
    const rows = await teamIssues();
    expect(rows.map((r) => [r.title, r.dueDate])).toEqual([
      ['Write docs', '2026-04-03'],
      ['Ship it', null],
    ]);
    expect(rows[1]!.stateId).toBe(states.Done!);
    const summary = done.summary as { skipped: { url: string; reason: string }[] };
    expect(summary.skipped).toEqual([{ url: 'Row 4', reason: 'No title' }]);
  });

  it('refuses members', async () => {
    const member = await signUpAs('member');
    const res = await plugin(member, '/instance/imports/csv/preview', { assetUrl: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('re-runs', () => {
  const job = async (rows: string) => {
    const url = await upload(owner, rows);
    const res = await plugin(owner, '/instance/imports/csv/create', {
      assetUrl: url,
      source: 'jira',
      teamId,
    });
    const { import: row } = (await res.json()) as { import: { id: string } };
    await waitFor(row.id, isAwaitingPeople);
    await plugin(owner, '/instance/imports/process', { id: row.id, people: {} });
    return waitFor(row.id, (r) => r.status === 'complete');
  };

  it('skips finished rows and rebuilds a half-written one', async () => {
    if (!storeAvailable) return;
    await job(JIRA);
    const [first, second] = await teamIssues();
    // A run stopped while ENG-2 was half written.
    await db
      .update(issueImportSource)
      .set({ imported: false })
      .where(eq(issueImportSource.issueId, second!.id));
    const again = await job(JIRA);
    const rows = await teamIssues();
    expect(rows.map((r) => r.title).sort()).toEqual(['Dark mode', 'Export to CSV', 'Old idea']);
    expect(rows.find((r) => r.title === 'Export to CSV')!.id).toBe(first!.id);
    expect(rows.find((r) => r.title === 'Dark mode')!.id).not.toBe(second!.id);
    expect((again.summary as { skippedExisting: number }).skippedExisting).toBe(2);
  });

  it('does not skip rows of a different file keyed by row number', async () => {
    if (!storeAvailable) return;
    const noKeys = (title: string) => `Summary,Status\n${title},Done\n`;
    await job(noKeys('First file row'));
    const second = await job(noKeys('Second file row'));
    expect((await teamIssues()).map((r) => r.title)).toEqual(['First file row', 'Second file row']);
    expect((second.summary as { skippedExisting: number }).skippedExisting).toBe(0);
  });
});

describe('the import file', () => {
  it('is deleted when processing fails', async () => {
    if (!storeAvailable) return;
    const url = await upload(owner, JIRA);
    const res = await plugin(owner, '/instance/imports/csv/create', {
      assetUrl: url,
      source: 'jira',
      teamId,
    });
    const { import: row } = (await res.json()) as { import: { id: string } };
    await waitFor(row.id, isAwaitingPeople);
    // The destination team is gone before processing.
    await db.delete(issueImportSource);
    await gqlData(owner, `mutation($id: String!) { teamDelete(id: $id) { success } }`, {
      id: teamId,
    });
    await expect(processImport(row.id, { serviceLabel: 'Jira', issues: [] }, {})).rejects.toThrow();
    expect(await uploadRow(url)).toBeUndefined();
    expect(
      await db
        .select()
        .from(issue)
        .where(and(eq(issue.teamId, teamId))),
    ).toEqual([]);
  });
});

// Review fixes: status guesses, status targets, mapping updates, waiting limits, file
// lifetime on expiry and restart, the Jira link, and import files kept out of
// attachments.
describe('review fixes', () => {
  const create = async (url: string, extra: Record<string, unknown> = {}) =>
    plugin(owner, '/instance/imports/csv/create', {
      assetUrl: url,
      source: 'jira',
      teamId,
      ...extra,
    });
  const waiting = async (extra: Record<string, unknown> = {}) => {
    const url = await upload(owner, JIRA);
    const res = await create(url, extra);
    expect(res.status).toBe(200);
    const { import: row } = (await res.json()) as { import: { id: string } };
    return { url, row: await waitFor(row.id, isAwaitingPeople) };
  };

  it('stores a guessed state for every status', async () => {
    if (!storeAvailable) return;
    const { row } = await waiting();
    const guesses = (row.serviceMetadata as { statusGuesses: Record<string, string> })
      .statusGuesses;
    expect(guesses.Done).toBe(states.Done!);
    expect(guesses['In Review']).toBe(states['In Progress']!);
    expect(guesses["Won't Do"]).toBe(states.Canceled!);
  });

  it('guesses default state names for a new team', async () => {
    if (!storeAvailable) return;
    const { row } = await waiting({ teamId: undefined, teamName: 'Imported' });
    const guesses = (row.serviceMetadata as { statusGuesses: Record<string, string> })
      .statusGuesses;
    expect(guesses.Done).toBe('Done');
    expect(guesses["Won't Do"]).toBe('Canceled');
  });

  it('refuses a status mapped to a state the team does not have', async () => {
    if (!storeAvailable) return;
    const { row } = await waiting();
    const res = await plugin(owner, '/instance/imports/process', {
      id: row.id,
      people: {},
      statuses: { Done: 'Nope' },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain('"Done"');
    expect(isAwaitingPeople((await getImport(row.id))!)).toBe(true);
  });

  it('refuses a status mapped to an archived state', async () => {
    if (!storeAvailable) return;
    const old = (await createState(owner, { teamId, name: 'Old', type: 'started' })).id;
    await gqlData(owner, `mutation($id: String!) { workflowStateArchive(id: $id) { success } }`, {
      id: old,
    });
    const { row } = await waiting();
    const res = await plugin(owner, '/instance/imports/process', {
      id: row.id,
      people: {},
      statuses: { Done: old },
    });
    expect(res.status).toBe(400);
  });

  it('refuses issueImportUpdate once the import is no longer waiting', async () => {
    if (!storeAvailable) return;
    const { row } = await waiting();
    await plugin(owner, '/instance/imports/process', { id: row.id, people: {} });
    await waitFor(row.id, (r) => r.status === 'complete');
    const res = await gql(
      { cookie: owner.cookie },
      `mutation($id: String!, $mapping: JSONObject!) {
         issueImportUpdate(id: $id, input: { mapping: $mapping }) { success }
       }`,
      { id: row.id, mapping: { statuses: { Done: 'Backlog' } } },
    );
    expect(res.body.errors?.[0]?.extensions?.code).toBe('CONFLICT');
  });

  it('allows at most three waiting CSV imports per person', async () => {
    if (!storeAvailable) return;
    for (let i = 0; i < 3; i += 1) await waiting();
    const url = await upload(owner, JIRA);
    const res = await create(url);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toBe(
      'Finish or cancel a waiting import first',
    );
    // A refused create leaves the file unused, so the daily sweep removes it.
    expect((await uploadRow(url))!.usedAt).toBeNull();
  });

  it('deletes the file when a waiting import expires', async () => {
    if (!storeAvailable) return;
    const { url } = await waiting();
    await expireWaitingImports(new Date(Date.now() + 25 * 3_600_000));
    expect(await uploadRow(url)).toBeUndefined();
  });

  it('deletes the file when an interrupted import is swept on restart', async () => {
    if (!storeAvailable) return;
    const { url } = await waiting();
    await sweepInterruptedImports();
    expect(await uploadRow(url)).toBeUndefined();
  });

  it('marks the Jira link imported and encodes the key', async () => {
    if (!storeAvailable) return;
    const rows = 'Summary,Issue key,Status\nOdd key,ENG 9#x,Done\n';
    const url = await upload(owner, rows);
    const res = await create(url, { jiraHostname: 'acme.atlassian.net' });
    const { import: row } = (await res.json()) as { import: { id: string } };
    await waitFor(row.id, isAwaitingPeople);
    await plugin(owner, '/instance/imports/process', { id: row.id, people: {} });
    await waitFor(row.id, (r) => r.status === 'complete');
    const [link] = await db.select().from(attachment).where(eq(attachment.title, 'Jira ENG 9#x'));
    expect(link!.url).toBe('https://acme.atlassian.net/browse/ENG%209%23x');
    expect((link!.metadata as { imported: boolean }).imported).toBe(true);
  });

  it('guesses the date format from every row', async () => {
    if (!storeAvailable) return;
    const lines = ['Title,Due'];
    for (let i = 0; i < 60; i += 1)
      lines.push(`Row ${i},${i === 55 ? '25/03/2026' : '01/02/2026'}`);
    const url = await upload(owner, lines.join('\n'));
    const res = await plugin(owner, '/instance/imports/csv/preview', { assetUrl: url });
    const view = (await res.json()) as { guess: { dateFormat: string } };
    expect(view.guess.dateFormat).toBe('dayFirst');
  });

  it('does not let an import file become an attachment', async () => {
    if (!storeAvailable) return;
    const url = await upload(owner, JIRA);
    const created = await createIssue(owner, { teamId, title: 'Target' });
    const res = await gql(
      { cookie: owner.cookie },
      `mutation($issueId: String!, $url: String!) {
         attachmentCreate(input: { issueId: $issueId, url: $url, title: "csv" }) { success }
       }`,
      { issueId: created.id, url },
    );
    expect(res.body.errors?.[0]?.message).toBe(
      'input.url must be one of your finished, unused uploads',
    );
  });
});
