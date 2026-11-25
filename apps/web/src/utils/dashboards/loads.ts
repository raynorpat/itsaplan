import { fetchPagesUpTo, type Page } from '@/utils/fetchAllPages';
import type { FilterCondition } from '@/utils/filters';
import { filterSetToIssueFilter, type IssueFilter } from '@/utils/viewFilters';
import { measureDef, type CycleFilter, type DashboardPeriod, type Widget } from './config';
import { periodRange } from './periods';

// What a widget loads: the rows of one data kind the viewer may read, narrowed on the
// server as far as Linear's filters allow. Widgets whose loads are equal share one
// fetch (the load key is the TanStack Query key); the widget's own filter and the
// period are still applied in the browser when its figures are worked out.

export const DASHBOARD_ROW_LIMIT = 5000;

export type LoadKey = string;

export interface DashboardState {
  period: DashboardPeriod;
  teamId: string | null;
}

export type LoadSpec =
  // Issues: open ones for measures of the current state, otherwise those created or
  // completed since the start of the previous period (a number's comparison).
  // `requests`: the issues' feedback counts are loaded too.
  | { data: 'issues'; filter: IssueFilter; requests: boolean }
  // Feedback requests: every active one on the matching issues, whatever the period,
  // since time to start and waiting count from an issue's first request.
  | { data: 'requests'; filter: IssueFilter }
  | { data: 'projects' }
  // Cycles that end after the start of the previous period, and those still running.
  | { data: 'cycles'; filter: Record<string, unknown> }
  // The widget's teams and the dashboard's team rule each other out.
  | { data: 'none' };

const OPEN = { state: { type: { nin: ['completed', 'canceled'] } } };

const REQUEST_MEASURES = new Set(['requests', 'requesters']);
const REQUEST_COLUMNS = new Set(['requests', 'people']);

// Whether an issue widget shows feedback counts (its measure, a table column or the
// table's sort), which the issue load then fetches alongside.
export function issueWidgetNeedsRequests(widget: Widget): boolean {
  const { measure, table } = widget.config;
  if (REQUEST_MEASURES.has(measure)) return true;
  if (!table) return false;
  return (
    table.columns.some((c) => REQUEST_COLUMNS.has(c)) ||
    REQUEST_COLUMNS.has(table.sort.split(':')[0] ?? '')
  );
}

// The dashboard-only "team" condition of an issue or request widget, as Linear's
// IssueFilter.team; null when it leaves no team beside the dashboard's own.
function teamElement(c: FilterCondition, teamId: string | null): IssueFilter | null | undefined {
  const ids = c.values.filter((v): v is string => typeof v === 'string');
  if (ids.length === 0) return undefined;
  if (c.op === 'is') {
    if (teamId && !ids.includes(teamId)) return null;
    return { team: { id: { in: ids } } };
  }
  if (c.op === 'is_not') {
    if (teamId && ids.includes(teamId)) return null;
    return { team: { id: { nin: ids } } };
  }
  return undefined;
}

// A widget's issue filter (the view filter plus its team conditions) and the
// dashboard's team, as one IssueFilter; null when they cannot both hold.
export function scopeFilter(
  conditions: FilterCondition[],
  teamId: string | null,
): IssueFilter | null {
  const elements: IssueFilter[] = [];
  const view = filterSetToIssueFilter({ conditions: conditions.filter((c) => c.field !== 'team') });
  if (Array.isArray(view.and)) elements.push(...(view.and as IssueFilter[]));
  for (const c of conditions) {
    if (c.field !== 'team') continue;
    const element = teamElement(c, teamId);
    if (element === null) return null;
    if (element) elements.push(element);
  }
  if (teamId) elements.push({ team: { id: { eq: teamId } } });
  if (elements.length === 0) return {};
  return elements.length === 1 ? elements[0]! : { and: elements };
}

const and = (...filters: IssueFilter[]): IssueFilter => {
  const parts = filters.filter((f) => Object.keys(f).length > 0);
  if (parts.length === 0) return {};
  return parts.length === 1 ? parts[0]! : { and: parts };
};

// The start of the previous period at midnight UTC, so the key holds through the day.
function sinceDay(period: DashboardPeriod, now: Date): string {
  const { previousStart } = periodRange(period, now);
  const t = previousStart.getTime();
  return new Date(t - (t % 86_400_000)).toISOString();
}

// Where the "new people" lookup starts: the previous period, so the number's
// comparison has its new people too.
export const firstFeedbackSince = (period: DashboardPeriod, now: Date): string =>
  sinceDay(period, now);

export function loadSpecFor(widget: Widget, dashboard: DashboardState, now: Date): LoadSpec {
  const { config } = widget;
  switch (config.data) {
    case 'issues': {
      const scope = scopeFilter(config.filter as FilterCondition[], dashboard.teamId);
      if (!scope) return { data: 'none' };
      const requests = issueWidgetNeedsRequests(widget);
      if (measureDef('issues', config.measure)?.basis === 'current')
        return { data: 'issues', filter: and(scope, OPEN), requests };
      const since = sinceDay(dashboard.period, now);
      return {
        data: 'issues',
        filter: and(scope, {
          or: [{ createdAt: { gte: since } }, { completedAt: { gte: since } }],
        }),
        requests,
      };
    }
    case 'requests': {
      const scope = scopeFilter(config.filter as FilterCondition[], dashboard.teamId);
      if (!scope) return { data: 'none' };
      return { data: 'requests', filter: Object.keys(scope).length ? { issue: scope } : {} };
    }
    case 'projects':
      return { data: 'projects' };
    case 'cycles': {
      const teamIds = (config.filter as CycleFilter).teamIds ?? [];
      const { teamId } = dashboard;
      if (teamId && teamIds.length && !teamIds.includes(teamId)) return { data: 'none' };
      const team = teamId
        ? { team: { id: { eq: teamId } } }
        : teamIds.length
          ? { team: { id: { in: teamIds } } }
          : {};
      return {
        data: 'cycles',
        filter: and(team, { endsAt: { gte: sinceDay(dashboard.period, now) } }),
      };
    }
  }
}

// Object keys in a fixed order, so equal loads give equal keys.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export const loadKeyFor = (widget: Widget, dashboard: DashboardState, now: Date): LoadKey =>
  stable(loadSpecFor(widget, dashboard, now));

// A connection loaded in pages of 250 up to the dashboard's row limit.
export const pagedLoad = <T>(
  fetchPage: (after: string | null, first: number) => Promise<Page<T>>,
): Promise<{ nodes: T[]; capped: boolean }> => fetchPagesUpTo(fetchPage, DASHBOARD_ROW_LIMIT);
