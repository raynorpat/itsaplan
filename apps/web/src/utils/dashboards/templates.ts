import type { FilterCondition } from '@/utils/filters';
import type {
  CycleFilter,
  DataKind,
  ProjectFilter,
  TableConfig,
  Widget,
  WidgetConfig,
} from './config';

// The ready-made dashboards offered by New dashboard (and, for Feedback, by Feedback →
// Reports). Each creates an ordinary dashboard the user can edit; the templates
// themselves are fixed here.
export interface DashboardTemplate {
  key: 'feedback' | 'delivery' | 'projects' | 'cycles' | 'bugs';
  name: string;
  description: string;
  // Bugs filters on the labels named "Bug" (workspace and team labels); New dashboard
  // asks for a label when there is none.
  needsBugLabel: boolean;
  widgets: (ctx: TemplateContext) => Widget[];
}

export interface TemplateContext {
  bugLabelIds: string[];
}

type Shape = Partial<Omit<WidgetConfig, 'title' | 'data' | 'measure'>>;

function widget(
  id: string,
  kind: Widget['kind'],
  width: Widget['width'],
  data: DataKind,
  title: string,
  measure: string,
  shape: Shape = {},
): Widget {
  const issueLike = data === 'issues' || data === 'requests';
  const config: WidgetConfig = {
    title,
    data,
    filter: shape.filter ?? (issueLike ? [] : {}),
    measure,
    slice: shape.slice ?? null,
    segment: shape.segment ?? null,
  };
  if (shape.compareMeasure !== undefined) config.compareMeasure = shape.compareMeasure;
  if (shape.chart !== undefined) config.chart = shape.chart;
  if (shape.table !== undefined) config.table = shape.table;
  return { id, kind, width, config };
}

const condition = (id: string, field: string, values: string[]): FilterCondition => ({
  id,
  field,
  op: 'is',
  values,
});

const table = (columns: string[], sort: string, limit = 10): TableConfig => ({
  columns,
  sort,
  limit,
});

const ACTIVE_PROJECTS: ProjectFilter = { status: ['planned', 'started', 'paused'] };
const ALL_CYCLES: CycleFilter = {};

function feedbackWidgets(): Widget[] {
  const notStarted = [condition('fb-not-started', 'statusType', ['backlog', 'unstarted'])];
  return [
    widget('fb-requests', 'number', 'half', 'requests', 'Requests', 'requests'),
    widget('fb-people', 'number', 'half', 'requests', 'People', 'people'),
    widget('fb-new-people', 'number', 'half', 'requests', 'New people', 'newPeople'),
    widget('fb-important', 'number', 'half', 'requests', 'Marked important', 'importantShare'),
    widget('fb-per-week', 'chart', 'full', 'requests', 'Requests per week by source', 'requests', {
      slice: 'source',
      chart: 'overTimeBars',
    }),
    widget(
      'fb-most-requested',
      'table',
      'full',
      'requests',
      'Most requested, not done',
      'waiting',
      {
        table: table(['identifier', 'title', 'status', 'people', 'waitingDays'], 'people:desc', 20),
      },
    ),
    widget('fb-time-to-start', 'number', 'half', 'requests', 'Time to start', 'timeToStart'),
    widget('fb-time-to-done', 'number', 'half', 'requests', 'Time to done', 'timeToDone'),
    widget('fb-delivered', 'number', 'half', 'requests', 'Delivered issues', 'delivered'),
    widget(
      'fb-delivered-people',
      'number',
      'half',
      'requests',
      'People delivered to',
      'deliveredPeople',
    ),
    widget('fb-waiting', 'table', 'full', 'requests', 'Waiting longest, not started', 'waiting', {
      filter: notStarted,
      table: table(
        ['identifier', 'title', 'people', 'firstRequestAt', 'waitingDays'],
        'firstRequestAt:asc',
        20,
      ),
    }),
    // These two show "Customers are off" until Customers is turned on.
    widget('fb-by-tier', 'chart', 'half', 'requests', 'Requests by customer tier', 'requests', {
      slice: 'tier',
      chart: 'bars',
    }),
    widget(
      'fb-top-customers',
      'table',
      'half',
      'customers',
      'Top customers by requests',
      'customers',
      {
        table: table(['name', 'tier', 'requests', 'revenue'], 'requests:desc', 10),
      },
    ),
  ];
}

function deliveryWidgets(): Widget[] {
  return [
    widget('dl-flow', 'chart', 'full', 'issues', 'Created and completed per week', 'created', {
      compareMeasure: 'completed',
      chart: 'overTimeBars',
    }),
    widget('dl-cycle-time', 'chart', 'half', 'issues', 'Cycle time by team', 'cycleTime', {
      slice: 'team',
      chart: 'bars',
    }),
    widget('dl-lead-time', 'chart', 'half', 'issues', 'Lead time by team', 'leadTime', {
      slice: 'team',
      chart: 'bars',
    }),
    widget('dl-by-status', 'chart', 'half', 'issues', 'Open issues by status', 'open', {
      slice: 'status',
      chart: 'bars',
    }),
    widget('dl-by-priority', 'chart', 'half', 'issues', 'Open issues by priority', 'open', {
      slice: 'priority',
      chart: 'bars',
    }),
    widget('dl-age', 'number', 'half', 'issues', 'Age of open issues', 'age'),
    widget('dl-completed', 'number', 'half', 'issues', 'Issues completed', 'completed'),
  ];
}

function projectWidgets(): Widget[] {
  return [
    widget('pj-health', 'chart', 'half', 'projects', 'Active projects by health', 'projects', {
      filter: ACTIVE_PROJECTS,
      slice: 'health',
      chart: 'bars',
    }),
    widget('pj-progress', 'number', 'half', 'projects', 'Average progress', 'avgProgress', {
      filter: ACTIVE_PROJECTS,
    }),
    widget('pj-active', 'table', 'full', 'projects', 'Active projects', 'projects', {
      filter: ACTIVE_PROJECTS,
      table: table(
        ['name', 'status', 'health', 'progress', 'targetDate', 'lead'],
        'targetDate:asc',
        20,
      ),
    }),
    widget('pj-due', 'table', 'full', 'projects', 'Target dates in the next 30 days', 'projects', {
      filter: { ...ACTIVE_PROJECTS, targetWithinDays: 30 },
      table: table(['name', 'health', 'progress', 'targetDate', 'lead'], 'targetDate:asc', 20),
    }),
  ];
}

function cycleWidgets(): Widget[] {
  return [
    widget(
      'cy-completed',
      'chart',
      'full',
      'cycles',
      'Completed scope per cycle',
      'completedScope',
      {
        filter: ALL_CYCLES,
        slice: 'cycle',
        chart: 'bars',
      },
    ),
    widget(
      'cy-carried',
      'chart',
      'half',
      'cycles',
      'Issues carried over per cycle',
      'carriedOver',
      {
        filter: ALL_CYCLES,
        slice: 'cycle',
        chart: 'bars',
      },
    ),
    widget('cy-current', 'chart', 'half', 'cycles', 'Current cycle progress', 'currentProgress', {
      filter: ALL_CYCLES,
      slice: 'team',
      chart: 'bars',
    }),
    widget('cy-recent', 'table', 'full', 'cycles', 'Recent cycles', 'completedScope', {
      filter: ALL_CYCLES,
      table: table(
        ['team', 'cycle', 'endsAt', 'scope', 'completedScope', 'carriedOver', 'progress'],
        'endsAt:desc',
        20,
      ),
    }),
  ];
}

function bugWidgets(bugLabelIds: string[]): Widget[] {
  const bugs = (id: string) => [condition(`${id}-label`, 'labels', [...bugLabelIds])];
  return [
    widget('bg-flow', 'chart', 'full', 'issues', 'Bugs created and fixed per week', 'created', {
      filter: bugs('bg-flow'),
      compareMeasure: 'completed',
      chart: 'overTimeBars',
    }),
    widget('bg-by-priority', 'chart', 'half', 'issues', 'Open bugs by priority', 'open', {
      filter: bugs('bg-by-priority'),
      slice: 'priority',
      chart: 'bars',
    }),
    widget('bg-time-to-fix', 'number', 'half', 'issues', 'Time to fix', 'leadTime', {
      filter: bugs('bg-time-to-fix'),
    }),
    widget('bg-oldest', 'table', 'full', 'issues', 'Oldest open bugs', 'open', {
      filter: bugs('bg-oldest'),
      table: table(['identifier', 'title', 'priority', 'assignee', 'ageDays'], 'ageDays:desc', 10),
    }),
  ];
}

export const TEMPLATES: DashboardTemplate[] = [
  {
    key: 'feedback',
    name: 'Feedback',
    description: 'What people ask for, where it comes from and how fast the team answers.',
    needsBugLabel: false,
    widgets: feedbackWidgets,
  },
  {
    key: 'delivery',
    name: 'Delivery',
    description: 'Issues created and completed, cycle and lead time, and open work.',
    needsBugLabel: false,
    widgets: deliveryWidgets,
  },
  {
    key: 'projects',
    name: 'Projects',
    description: 'Project health, progress and upcoming target dates.',
    needsBugLabel: false,
    widgets: projectWidgets,
  },
  {
    key: 'cycles',
    name: 'Cycles',
    description: 'Completed scope, carried-over issues and the current cycle per team.',
    needsBugLabel: false,
    widgets: cycleWidgets,
  },
  {
    key: 'bugs',
    name: 'Bugs',
    description: 'Bugs created and fixed, open bugs by priority and time to fix.',
    needsBugLabel: true,
    widgets: ({ bugLabelIds }) => bugWidgets(bugLabelIds),
  },
];

// The ids of the labels named "Bug" (case-insensitive), for the Bugs template.
export function bugLabelIds(labels: { id: string; name: string }[]): string[] {
  return labels.filter((l) => l.name.trim().toLowerCase() === 'bug').map((l) => l.id);
}

export function findTemplate(key: DashboardTemplate['key']): DashboardTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}
