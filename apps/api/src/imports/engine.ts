import { attachment, db, issue, label, teamMember, workflowState } from '@repo/db';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { createComment } from '../comments/store';
import { createIssue } from '../issues/store';
import { createLabel } from '../labels/store';
import { joinTeam } from '../members/store';
import { HttpError } from '../shared/lib';
import { runAsImport } from '../shared/workflow-context';
import { createTeam, getTeamById, getTeamByKey, type TeamRow } from '../teams/store';
import { normalizeColor, pastDate, personName, splitTitle, teamKeyFor } from './normalize';
import { getImport, setImportProgress, setImportStatus } from './store';
import type { ImportSummary, SourceData, SourceIssue, SourcePerson } from './types';

export { suggestPeople } from './normalize';

// Creates the destination team's records from fetched source data (Linear's
// issueImportProcess). Runs inside runAsImport, so no workflow rule, notification or
// webhook follows from it. Each issue is written with its link back to the source in
// the same transaction, marked `imported: false` until its comments are in; a rerun
// skips an issue whose link says `imported: true` (or any link with that URL in the
// team that an import did not write) and rebuilds one left half-written.

// Linear's progress is updated at most this often (and at the end).
const PROGRESS_EVERY_MS = 1000;

export interface ImportHooks {
  // Called after each issue (and its link) is created, before its comments: tests
  // stop a run there to check an interrupted import.
  afterIssueCreated?: (issueId: string) => void | Promise<void>;
}

interface StateIds {
  open: string;
  completed: string;
  canceled: string;
}

async function teamStates(teamId: string): Promise<StateIds> {
  const rows = await db
    .select({ id: workflowState.id, type: workflowState.stateType })
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
  };
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
  hooks: ImportHooks = {},
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
    total: data.issues.length,
    skipped: [],
  };
  try {
    const team = await destinationTeam(job, creatorId, people);
    await setImportStatus(importId, 'inProcess', {
      teamId: team.id,
      mapping: { people },
      progress: 0,
      error: null,
    });
    await runAsImport(importId, () =>
      createAll(importId, team, creatorId, data, people, summary, hooks),
    );
    await setImportStatus(importId, 'complete', { progress: 100, summary });
    return summary;
  } catch (err) {
    await setImportStatus(importId, 'error', {
      error: err instanceof Error ? err.message : 'The import failed',
      summary,
    });
    throw err;
  }
}

async function createAll(
  importId: string,
  team: TeamRow,
  creatorId: string,
  data: SourceData,
  people: Record<string, string | null>,
  summary: ImportSummary,
  hooks: ImportHooks,
): Promise<void> {
  const states = await teamStates(team.id);
  const members = new Set(
    (
      await db
        .select({ userId: teamMember.userId })
        .from(teamMember)
        .where(eq(teamMember.teamId, team.id))
    ).map((m) => m.userId),
  );
  // A mapping to someone outside the team is dropped (unassigned, importer as author).
  const member = (p: SourcePerson | null) => {
    const id = p ? people[p.key] : null;
    return id && members.has(id) ? id : null;
  };
  const labels = await labelIndex(team.id);
  const existing = await existingLinks(
    team.id,
    data.issues.map((i) => i.url),
  );

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
    const link = existing.get(source.url);
    if (link?.imported) {
      summary.skippedExisting += 1;
    } else {
      // A half-written issue from an interrupted run is rebuilt.
      if (link) await db.delete(issue).where(eq(issue.id, link.issueId));
      try {
        await importIssue(
          importId,
          team,
          creatorId,
          data,
          source,
          states,
          member,
          labelIds,
          summary,
          hooks,
        );
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        summary.skipped.push({ url: source.url, reason: err.message });
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
  member: (p: SourcePerson | null) => string | null,
  labelIds: (source: SourceIssue['labels']) => Promise<string[]>,
  summary: ImportSummary,
  hooks: ImportHooks,
): Promise<void> {
  const createdAt = pastDate(source.createdAt);
  const closedAt = source.closedAt ? pastDate(source.closedAt) : createdAt;
  const closed = closedAt.getTime() < createdAt.getTime() ? createdAt : closedAt;
  const { title, description } = splitTitle(source.title, source.body);
  const stateId =
    source.state === 'open'
      ? states.open
      : source.state === 'closed'
        ? states.completed
        : states.canceled;
  const created = await createIssue(
    team,
    {
      stateId,
      title,
      description,
      assigneeUserId: member(source.assignee),
      labelIds: await labelIds(source.labels),
    },
    member(source.author) ?? creatorId,
    {
      createdAt,
      ...(source.state === 'closed' ? { completedAt: closed } : {}),
      ...(source.state === 'notPlanned' ? { closedAt: closed } : {}),
      link: {
        url: source.url,
        title: `${data.serviceLabel} #${source.number}`,
        metadata: { issueImportId: importId, imported: false },
      },
    },
  );
  await hooks.afterIssueCreated?.(created.id);
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
  await db
    .update(attachment)
    .set({ metadata: sql`${attachment.metadata} || '{"imported": true}'::jsonb` })
    .where(and(eq(attachment.issueId, created.id), eq(attachment.url, source.url)));
  summary.issues += 1;
}
