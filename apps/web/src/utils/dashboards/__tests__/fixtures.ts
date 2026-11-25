import type { InsightIssue, InsightsContext } from '@/utils/insights/slices';
import type { Widget, WidgetConfig, WidgetKind } from '../config';
import type { ComputeContext } from '../compute';
import type { CycleRow } from '../cycleMeasures';
import type { RequestRow } from '../feedbackMeasures';
import type { ProjectRow } from '../projectMeasures';

export const NOW = new Date('2026-11-24T12:00:00.000Z');

export const insights: InsightsContext = {
  states: new Map([
    ['s-todo', { name: 'Todo', type: 'unstarted', position: 1 }],
    ['s-doing', { name: 'In Progress', type: 'started', position: 2 }],
    ['s-done', { name: 'Done', type: 'completed', position: 3 }],
  ]),
  users: new Map([['u-pat', 'Pat']]),
  labels: new Map([['l-bug', 'Bug']]),
  cycles: new Map(),
  teams: new Map([
    ['t-eng', 'Engineering'],
    ['t-des', 'Design'],
  ]),
};

export function ctx(over: Partial<ComputeContext> = {}): ComputeContext {
  return { now: NOW, period: '30d', teamId: null, insights, firstFeedback: new Map(), ...over };
}

export function issue(over: Partial<InsightIssue> & { id: string }): InsightIssue {
  return {
    teamId: 't-eng',
    identifier: `ENG-${over.id}`,
    title: `Issue ${over.id}`,
    stateId: 's-todo',
    assigneeUserId: null,
    creatorUserId: 'u-pat',
    priority: 0,
    estimate: null,
    labelIds: [],
    project: null,
    cycleId: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...over,
  };
}

export function request(
  id: string,
  of: InsightIssue,
  over: Partial<Omit<RequestRow, 'id' | 'issue'>> = {},
): RequestRow {
  return {
    id,
    createdAt: '2026-11-10T00:00:00.000Z',
    important: false,
    source: 'team',
    requesterId: `p-${id}`,
    issue: of,
    ...over,
  };
}

export function project(over: Partial<ProjectRow> & { id: string }): ProjectRow {
  return {
    name: `Project ${over.id}`,
    status: 'started',
    leadId: null,
    leadName: null,
    teamIds: ['t-eng'],
    labelIds: [],
    health: null,
    progress: 0,
    targetDate: null,
    ...over,
  };
}

export function cycle(over: Partial<CycleRow> & { id: string }): CycleRow {
  return {
    teamId: 't-eng',
    teamKey: 'ENG',
    number: 1,
    name: null,
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2026-11-15T00:00:00.000Z',
    completedAt: '2026-11-15T00:00:00.000Z',
    unit: 'issues',
    scope: 10,
    completedScope: 6,
    carriedOver: 2,
    progress: 0.6,
    ...over,
  };
}

export function widget(
  kind: WidgetKind,
  config: Partial<WidgetConfig> & Pick<WidgetConfig, 'data' | 'measure'>,
): Widget {
  return {
    id: 'w',
    kind,
    width: 'half',
    config: { title: 'T', filter: [], slice: null, segment: null, ...config },
  };
}
