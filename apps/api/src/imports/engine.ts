import {
  attachment,
  db,
  issue,
  issueImportSource,
  label,
  team as teamTable,
  teamMember,
  user,
  workflowState,
} from '@repo/db';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { createComment } from '../comments/store';
import { createIssue } from '../issues/store';
import { createLabel } from '../labels/store';
import { joinTeam } from '../members/store';
import { HttpError } from '../shared/lib';
import { runAsImport } from '../shared/workflow-context';
import { isValidEstimate } from '../teams/estimates';
import {
  createTeam,
  DEFAULT_COLUMNS,
  getTeamById,
  getTeamByKey,
  type TeamRow,
} from '../teams/store';
import { guessStatusState, type StateOption } from './csv/guess';
import { normalizeColor, pastDate, personName, splitTitle, teamKeyFor } from './normalize';
import { releaseImportFile } from './files';
import { getImport, setImportProgress, setImportStatus } from './store';
import type { ImportSummary, SourceData, SourceIssue, SourcePerson } from './types';

export { suggestPeople } from './normalize';

// Creates the destination team's records from fetched source data (Linear's
// issueImportProcess). Runs inside runAsImport, so no workflow rule, notification or
// webhook follows from it. Each issue is written with its link back to the source in
// the same transaction, marked `imported: false` until its comments are in; a rerun
// skips an issue whose link says `imported: true` (or any link with that URL in the
// team that an import did not write) and rebuilds one left half-written. A CSV row has
// no source URL: its identity in the team (`sourceKey`) is recorded in
// issue_import_source in the issue's transaction, with the same `imported` flag; its
// state comes from the Statuses mapping (source status → state id or name), else the
// guess for the status (csv/guess.ts).

// Linear's progress is updated at most this often (and at the end).
const PROGRESS_EVERY_MS = 1000;

interface StateIds {
  open: string;
  completed: string;
  canceled: string;
  all: StateOption[];
}

async function teamStates(teamId: string): Promise<StateIds> {
  const rows = await db
    .select({
      id: workflowState.id,
      name: workflowState.name,
      type: workflowState.stateType,
      position: workflowState.position,
    })
    .from(workflowState)
    .where(and(eq(workflowState.teamId, teamId), isNull(workflowState.archivedAt)))
    .orderBy(asc(workflowState.position));
  const first = (type: string) => rows.find((r) => r.type === type)?.id;
  const any = rows[0]?.id;
  if (!any) throw new HttpError(400, 'The team has no statuses');
  const completed = first('completed') ?? any;
  return {
    open: first('unstarted') ?? first('backlog') ?? any,
    completed,
    canceled: first('canceled') ?? completed,
    all: rows.map((r) => ({ id: r.id, name: r.name, type: r.type, position: Number(r.position) })),
  };
}

// The states a CSV import's statuses map onto, with the default for unknown values: the
// destination team's active states, or, for a team the import creates, its default
// columns named by name (their ids do not exist yet).
export async function destinationStates(
  teamId: string | null,
): Promise<{ states: StateOption[]; defaultId: string }> {
  if (!teamId) {
    const states = DEFAULT_COLUMNS.map((c, i) => ({
      id: c.name,
      name: c.name,
      type: c.stateType,
      position: i,
    }));
    return { states, defaultId: states.find((s) => s.type === 'unstarted')!.id };
  }
  const ids = await teamStates(teamId);
  return { states: ids.all, defaultId: ids.open };
}

// Refuses a Statuses mapping whose target is not one of the destination's active
// states (by id or name, ignoring case), naming the status value.
export async function checkStatusTargets(
  teamId: string | null,
  statuses: Record<string, string>,
): Promise<void> {
  if (Object.keys(statuses).length === 0) return;
  const { states } = await destinationStates(teamId);
  for (const [value, target] of Object.entries(statuses)) {
    const lower = target.toLowerCase();
    if (!states.some((s) => s.id === target || s.name.trim().toLowerCase() === lower))
      throw new HttpError(400, `Status "${value}" maps to a state the team does not have`);
  }
}

// The state a CSV row's status maps to: the Statuses mapping's state (an id of the
// team's or a name, ignoring case), else the guess; an empty status is the default.
function csvState(
  status: string | null | undefined,
  statuses: Record<string, string>,
  states: StateIds,
): StateOption {
  const value = (status ?? '').trim();
  const target = value ? statuses[value]?.trim() : undefined;
  const chosen = target
    ? (states.all.find((s) => s.id === target) ??
      states.all.find((s) => s.name.trim().toLowerCase() === target.toLowerCase()))
    : undefined;
  const id = chosen?.id ?? guessStatusState(value, states.all, states.open);
  return states.all.find((s) => s.id === id)!;
}

// CSV rows already in the team, by source key.
async function existingSources(
  teamId: string,
  keys: string[],
): Promise<Map<string, { issueId: string; imported: boolean }>> {
  const out = new Map<string, { issueId: string; imported: boolean }>();
  for (let i = 0; i < keys.length; i += 500) {
    const rows = await db
      .select({
        key: issueImportSource.sourceKey,
        issueId: issueImportSource.issueId,
        imported: issueImportSource.imported,
      })
      .from(issueImportSource)
      .where(
        and(
          eq(issueImportSource.teamId, teamId),
          inArray(issueImportSource.sourceKey, keys.slice(i, i + 500)),
        ),
      );
    for (const r of rows) out.set(r.key, { issueId: r.issueId, imported: r.imported });
  }
  return out;
}

// The destination team: the import's team, or a team created by name with Linear's
// default statuses, owned by the importer, joined by the matched members.
async function destinationTeam(
  job: { teamId: string | null; teamName: string | null },
  creatorId: string,
  people: Record<string, string | null>,
): Promise<TeamRow> {
  if (job.teamId) {
    const found = await getTeamById(job.teamId);
    if (!found) throw new HttpError(404, 'The destination team no longer exists');
    return found;
  }
  const name = job.teamName?.trim();
  if (!name) throw new HttpError(400, 'The import has no destination team');
  for (let n = 1; ; n += 1) {
    const key = teamKeyFor(name, n);
    if (await getTeamByKey(key)) continue;
    const created = await createTeam({ key, name }, creatorId);
    // The people matched to members join the new team, so their issues keep them.
    for (const userId of new Set(Object.values(people))) {
      if (!userId || userId === creatorId) continue;
      try {
        await joinTeam(created.id, userId);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
      }
    }
    return created;
  }
}

// Labels by lowercased name: the team's and the workspace's, groups left out. A
// retired label is kept so it is neither applied nor created again.
async function labelIndex(teamId: string): Promise<Map<string, { id: string; retired: boolean }>> {
  const rows = await db
    .select({ id: label.id, name: label.name, retiredAt: label.retiredAt, teamId: label.teamId })
    .from(label)
    .where(and(eq(label.isGroup, false), or(eq(label.teamId, teamId), isNull(label.teamId))));
  const index = new Map<string, { id: string; retired: boolean }>();
  // A team label wins over a workspace label of the same name.
  for (const r of [...rows].sort((a, b) => Number(!!a.teamId) - Number(!!b.teamId)))
    index.set(r.name.trim().toLowerCase(), { id: r.id, retired: !!r.retiredAt });
  return index;
}

// Links to the source issues already in the team, by URL.
async function existingLinks(
  teamId: string,
  urls: string[],
): Promise<Map<string, { issueId: string; imported: boolean }>> {
  const out = new Map<string, { issueId: string; imported: boolean }>();
  for (let i = 0; i < urls.length; i += 500) {
    const rows = await db
      .select({ url: attachment.url, issueId: attachment.issueId, metadata: attachment.metadata })
      .from(attachment)
      .innerJoin(issue, eq(issue.id, attachment.issueId))
      .where(and(eq(issue.teamId, teamId), inArray(attachment.url, urls.slice(i, i + 500))));
    for (const r of rows)
      out.set(r.url, {
        issueId: r.issueId,
        imported: (r.metadata as Record<string, unknown>).imported !== false,
      });
  }
  return out;
}

export async function processImport(
  importId: string,
  data: SourceData,
  people: Record<string, string | null>,
  statuses: Record<string, string> = {},
): Promise<ImportSummary> {
  const job = await getImport(importId);
  if (!job) throw new HttpError(404, 'Import not found');
  if (!job.creatorId) throw new HttpError(400, 'The import has no creator');
  const creatorId = job.creatorId;
  const summary: ImportSummary = {
    issues: 0,
    skippedExisting: 0,
    comments: 0,
    labelsCreated: 0,
    total: data.issues.length + (data.csv?.skipped.length ?? 0),
    skipped: (data.csv?.skipped ?? []).map((s) => ({ url: `Row ${s.row}`, reason: s.reason })),
    ...(data.csv ? { counts: { ...data.csv.counts } } : {}),
  };
  try {
    const team = await destinationTeam(job, creatorId, people);
    await setImportStatus(importId, 'inProcess', {
      teamId: team.id,
      mapping: data.csv ? { people, statuses } : { people },
      progress: 0,
      error: null,
    });
    await runAsImport(importId, () =>
      createAll(importId, team, creatorId, data, people, statuses, summary),
    );
    await setImportStatus(importId, 'complete', { progress: 100, summary });
    return summary;
  } catch (err) {
    await setImportStatus(importId, 'error', {
      error: err instanceof Error ? err.message : 'The import failed',
      summary,
    });
    throw err;
  } finally {
    await releaseImportFile(job);
  }
}

async function createAll(
  importId: string,
  team: TeamRow,
  creatorId: string,
  data: SourceData,
  people: Record<string, string | null>,
  statuses: Record<string, string>,
  summary: ImportSummary,
): Promise<void> {
  const states = await teamStates(team.id);
  const [estimation] = await db
    .select({
      issueEstimationType: teamTable.issueEstimationType,
      issueEstimationExtended: teamTable.issueEstimationExtended,
      issueEstimationAllowZero: teamTable.issueEstimationAllowZero,
    })
    .from(teamTable)
    .where(eq(teamTable.id, team.id));
  const members = new Set(
    (
      await db
        .select({ userId: teamMember.userId })
        .from(teamMember)
        .innerJoin(user, eq(user.id, teamMember.userId))
        .where(and(eq(teamMember.teamId, team.id), isNull(user.suspendedAt)))
    ).map((m) => m.userId),
  );
  // A mapping to someone outside the team, or suspended, is dropped (unassigned,
  // importer as author).
  const member = (p: SourcePerson | null) => {
    const id = p ? people[p.key] : null;
    return id && members.has(id) ? id : null;
  };
  const labels = await labelIndex(team.id);
  const existing = await existingLinks(
    team.id,
    data.issues.filter((i) => !i.sourceKey).map((i) => i.url),
  );
  const existingRows = await existingSources(
    team.id,
    data.issues.flatMap((i) => (i.sourceKey ? [i.sourceKey] : [])),
  );
  // The estimate a CSV row keeps: one on the team's scale, else none (counted).
  const estimateFor = (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    if (estimation && isValidEstimate(estimation, value)) return value;
    if (summary.counts) summary.counts.badEstimate += 1;
    return null;
  };

  const labelIds = async (source: SourceIssue['labels']): Promise<string[]> => {
    const ids = new Set<string>();
    for (const l of source) {
      const name = l.name.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      let found = labels.get(key);
      if (!found) {
        const created = await createLabel({
          teamId: team.id,
          name,
          color: normalizeColor(l.color) ?? undefined,
          actorUserId: creatorId,
        });
        found = { id: created.id, retired: false };
        labels.set(key, found);
        summary.labelsCreated += 1;
      }
      if (!found.retired) ids.add(found.id);
    }
    return [...ids];
  };

  let lastProgress = Date.now();
  for (const [index, source] of data.issues.entries()) {
    const known = source.sourceKey ? existingRows : existing;
    const identity = source.sourceKey ?? source.url;
    const link = known.get(identity);
    if (link?.imported) {
      summary.skippedExisting += 1;
    } else {
      // A half-written issue from an interrupted run is rebuilt.
      if (link) await db.delete(issue).where(eq(issue.id, link.issueId));
      try {
        const issueId = await importIssue(
          importId,
          team,
          creatorId,
          data,
          source,
          states,
          statuses,
          estimateFor,
          member,
          labelIds,
          summary,
        );
        // A source issue listed again later in the data is then skipped.
        known.set(identity, { issueId, imported: true });
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        summary.skipped.push({ url: identity, reason: err.message });
      }
    }
    if (Date.now() - lastProgress >= PROGRESS_EVERY_MS) {
      lastProgress = Date.now();
      await setImportProgress(importId, ((index + 1) / data.issues.length) * 100, summary);
    }
  }
}

async function importIssue(
  importId: string,
  team: TeamRow,
  creatorId: string,
  data: SourceData,
  source: SourceIssue,
  states: StateIds,
  statuses: Record<string, string>,
  estimateFor: (value: number | null | undefined) => number | null,
  member: (p: SourcePerson | null) => string | null,
  labelIds: (source: SourceIssue['labels']) => Promise<string[]>,
  summary: ImportSummary,
): Promise<string> {
  const createdAt = pastDate(source.createdAt);
  const closedAt = source.closedAt ? pastDate(source.closedAt) : createdAt;
  const closed = closedAt.getTime() < createdAt.getTime() ? createdAt : closedAt;
  const { title, description } = splitTitle(source.title, source.body);
  // A CSV row's state type decides its completed or canceled date; other sources'
  // open / closed / not planned do.
  const csv = source.sourceKey !== undefined;
  const csvStateRow = csv ? csvState(source.status, statuses, states) : null;
  const stateId = csvStateRow
    ? csvStateRow.id
    : source.state === 'open'
      ? states.open
      : source.state === 'closed'
        ? states.completed
        : states.canceled;
  const completed = csvStateRow ? csvStateRow.type === 'completed' : source.state === 'closed';
  const canceled = csvStateRow ? csvStateRow.type === 'canceled' : source.state === 'notPlanned';
  const assigneeUserId = member(source.assignee);
  const ids = await labelIds(source.labels);
  const extra = csv
    ? {
        priority: source.priority ?? 0,
        estimate: estimateFor(source.estimate),
        dueDate: source.dueDate ?? null,
      }
    : {};
  const create = (assignee: string | null) =>
    createIssue(
      team,
      { stateId, title, description, assigneeUserId: assignee, labelIds: ids, ...extra },
      member(source.author) ?? creatorId,
      {
        createdAt,
        ...(completed ? { completedAt: closed } : {}),
        ...(canceled ? { closedAt: closed } : {}),
        ...(source.sourceKey ? { sourceKey: source.sourceKey } : {}),
        ...(source.url
          ? {
              link: {
                url: source.url,
                title: source.sourceKey?.startsWith('jira:')
                  ? `Jira ${source.sourceKey.slice('jira:'.length)}`
                  : `${data.serviceLabel} #${source.number}`,
                metadata: { issueImportId: importId, imported: false },
              },
            }
          : {}),
      },
    );
  let created;
  try {
    created = await create(assigneeUserId);
  } catch (err) {
    // The matched assignee left the team during the run: the issue is imported
    // unassigned.
    if (!(err instanceof HttpError) || !assigneeUserId) throw err;
    created = await create(null);
  }
  for (const c of source.comments) {
    await createComment({
      parent: { issueId: created.id },
      body: `**${personName(c.author)}** on ${data.serviceLabel} wrote:\n\n${c.body}`,
      actorUserId: member(c.author) ?? creatorId,
      createdAt: pastDate(c.createdAt),
      notify: false,
    });
    summary.comments += 1;
  }
  if (csv)
    await db
      .update(issueImportSource)
      .set({ imported: true })
      .where(eq(issueImportSource.issueId, created.id));
  // The link back to the source (always for API sources, a Jira CSV with a host) is
  // marked complete too.
  if (source.url)
    await db
      .update(attachment)
      .set({ metadata: sql`${attachment.metadata} || '{"imported": true}'::jsonb` })
      .where(and(eq(attachment.issueId, created.id), eq(attachment.url, source.url)));
  summary.issues += 1;
  return created.id;
}
