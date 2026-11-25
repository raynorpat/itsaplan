import {
  document,
  initiative,
  initiativeUpdate,
  project,
  projectStatus,
  projectUpdate,
  release,
  releasePipeline,
  releaseStage,
  teamView,
  user,
} from '@repo/db';
import { sql, type SQL } from 'drizzle-orm';
import { shownNameSql } from '../shared/user-name';
import { visibleUsers } from './resolvers/team';
import { newestFirst, parseCaselessSort, type SortBuilder } from './sort';

// Linear's sort inputs for the lists other than issues and users (graphql/sort.ts):
// ProjectSortInput, InitiativeSortInput, DocumentSortInput, CustomViewSortInput,
// ReleaseSortInput and ReleasePipelineSortInput. Every key reads the outer row of its
// list's table. Text orders without regard to case, as issue sorts do. Ties go to the
// newest first, then the id (paginateSorted). A person the viewer cannot see (a lead,
// owner or creator outside a guest's teams) sorts as empty.

const userName = (column: SQL, viewerId: string): SQL =>
  sql`(SELECT ${shownNameSql} FROM ${user} WHERE ${user.id} = ${column} AND ${visibleUsers(viewerId)})`;

// Linear's priority scale with "no priority" (0) after Low unless asked first.
const priority =
  (column: SQL): SortBuilder =>
  (options) => [
    {
      sql: sql`(CASE WHEN ${column} = 0 THEN ${options.noPriorityFirst ? 0 : 5} ELSE ${column} END)`,
      type: 'number',
    },
  ];

// On track, at risk, off track; no update sorts as empty.
const healthRank = (health: SQL): SQL =>
  sql`(CASE ${health} WHEN 'onTrack' THEN 0 WHEN 'atRisk' THEN 1 WHEN 'offTrack' THEN 2 END)`;

const latestProjectUpdate = (column: SQL): SQL =>
  sql`(SELECT ${column} FROM ${projectUpdate}
    WHERE ${projectUpdate.projectId} = ${project.id} AND ${projectUpdate.archivedAt} IS NULL
    ORDER BY ${projectUpdate.createdAt} DESC LIMIT 1)`;

const latestInitiativeUpdate = (column: SQL): SQL =>
  sql`(SELECT ${column} FROM ${initiativeUpdate}
    WHERE ${initiativeUpdate.initiativeId} = ${initiative.id} AND ${initiativeUpdate.archivedAt} IS NULL
    ORDER BY ${initiativeUpdate.createdAt} DESC LIMIT 1)`;

const projectSorts = (viewerId: string): Record<string, SortBuilder> => ({
  createdAt: () => [{ sql: sql`${project.createdAt}`, type: 'timestamp' }],
  updatedAt: () => [{ sql: sql`${project.updatedAt}`, type: 'timestamp' }],
  health: () => [
    { sql: healthRank(latestProjectUpdate(sql`${projectUpdate.health}`)), type: 'number' },
  ],
  lead: () => [{ sql: userName(sql`${project.leadUserId}`, viewerId), type: 'text' }],
  manual: () => [{ sql: sql`${project.sortOrder}`, type: 'number' }],
  name: () => [{ sql: sql`${project.name}`, type: 'text' }],
  priority: priority(sql`${project.priority}`),
  startDate: () => [{ sql: sql`${project.startDate}`, type: 'date' }],
  targetDate: () => [{ sql: sql`${project.targetDate}`, type: 'date' }],
  status: () => [
    {
      sql: sql`(SELECT ${projectStatus.position} FROM ${projectStatus} WHERE ${projectStatus.id} = ${project.statusId})`,
      type: 'number',
    },
  ],
});

const initiativeSorts = (viewerId: string): Record<string, SortBuilder> => ({
  createdAt: () => [{ sql: sql`${initiative.createdAt}`, type: 'timestamp' }],
  updatedAt: () => [{ sql: sql`${initiative.updatedAt}`, type: 'timestamp' }],
  health: () => [
    { sql: healthRank(latestInitiativeUpdate(sql`${initiativeUpdate.health}`)), type: 'number' },
  ],
  healthUpdatedAt: () => [
    { sql: latestInitiativeUpdate(sql`${initiativeUpdate.createdAt}`), type: 'timestamp' },
  ],
  manual: () => [{ sql: sql`${initiative.sortOrder}`, type: 'number' }],
  name: () => [{ sql: sql`${initiative.name}`, type: 'text' }],
  owner: () => [{ sql: userName(sql`${initiative.ownerUserId}`, viewerId), type: 'text' }],
  priority: priority(sql`${initiative.priority}`),
  targetDate: () => [{ sql: sql`${initiative.targetDate}`, type: 'date' }],
});

const documentSorts = (viewerId: string): Record<string, SortBuilder> => ({
  createdAt: () => [{ sql: sql`${document.createdAt}`, type: 'timestamp' }],
  updatedAt: () => [{ sql: sql`${document.updatedAt}`, type: 'timestamp' }],
  creator: () => [{ sql: userName(sql`${document.creatorUserId}`, viewerId), type: 'text' }],
  // A document's project is visible whenever the document is (documents/access.ts).
  project: () => [
    {
      sql: sql`(SELECT ${project.name} FROM ${project} WHERE ${project.id} = ${document.projectId})`,
      type: 'text',
    },
  ],
  title: () => [{ sql: sql`${document.title}`, type: 'text' }],
});

const customViewSorts: Record<string, SortBuilder> = {
  createdAt: () => [{ sql: sql`${teamView.createdAt}`, type: 'timestamp' }],
  updatedAt: () => [{ sql: sql`${teamView.updatedAt}`, type: 'timestamp' }],
  name: () => [{ sql: sql`${teamView.name}`, type: 'text' }],
  shared: () => [{ sql: sql`${teamView.shared}`, type: 'boolean' }],
};

// A release's stage: planned, started, completed, canceled, then the stage position.
const releaseSorts: Record<string, SortBuilder> = {
  stage: () => [
    {
      sql: sql`(SELECT CASE ${releaseStage.type} WHEN 'planned' THEN 0 WHEN 'started' THEN 1
        WHEN 'completed' THEN 2 WHEN 'canceled' THEN 3 END
        FROM ${releaseStage} WHERE ${releaseStage.id} = ${release.stageId})`,
      type: 'number',
    },
    {
      sql: sql`(SELECT ${releaseStage.position} FROM ${releaseStage} WHERE ${releaseStage.id} = ${release.stageId})`,
      type: 'number',
    },
  ],
};

const pipelineSorts: Record<string, SortBuilder> = {
  name: () => [{ sql: sql`${releasePipeline.name}`, type: 'text' }],
};

export const projectSortKeys = (input: unknown, viewerId: string) =>
  parseCaselessSort(input, projectSorts(viewerId));
export const initiativeSortKeys = (input: unknown, viewerId: string) =>
  parseCaselessSort(input, initiativeSorts(viewerId));
export const documentSortKeys = (input: unknown, viewerId: string) =>
  parseCaselessSort(input, documentSorts(viewerId));
export const customViewSortKeys = (input: unknown) => parseCaselessSort(input, customViewSorts);
export const releaseSortKeys = (input: unknown) => parseCaselessSort(input, releaseSorts);
export const pipelineSortKeys = (input: unknown) => parseCaselessSort(input, pipelineSorts);

// The tie-break of each list: newest first (then the id, added by paginateSorted).
export const tieBreaks = {
  project: newestFirst(sql`${project.createdAt}`),
  initiative: newestFirst(sql`${initiative.createdAt}`),
  document: newestFirst(sql`${document.createdAt}`),
  customView: newestFirst(sql`${teamView.createdAt}`),
  release: newestFirst(sql`${release.createdAt}`),
  pipeline: newestFirst(sql`${releasePipeline.createdAt}`),
};
