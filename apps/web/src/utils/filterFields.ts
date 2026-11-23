import type { TeamDetail } from '@/types/team';
import { PRIORITY_OPTIONS, STATE_TYPE_OPTIONS } from '@/utils/fieldOptions';
import { cycleLabel, cyclesVisible, knownCycles, sortedCycles } from '@/utils/cycles';
import {
  SUBSCRIBER_ME,
  type FilterCondition,
  type FilterOperator,
  type FilterSet,
  type FilterValue,
} from '@/utils/filters';

// The kind of value a field holds, which decides its operators and value editor.
export type FieldKind = 'set' | 'date';

export interface FieldOption {
  value: FilterValue;
  label: string;
  color?: string;
}

// One filterable field: how it is labeled, what kind of value it holds, and (for
// set fields) the choices. `field` is the persisted key.
export interface FieldSpec {
  field: string;
  label: string;
  kind: FieldKind;
  options?: FieldOption[];
}

// Operators available for each field kind, in menu order.
export const OPERATORS_BY_KIND: Record<FieldKind, FilterOperator[]> = {
  set: ['is', 'is_not'],
  date: ['before', 'after', 'is_set', 'is_not_set'],
};

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: 'is',
  is_not: 'is not',
  before: 'before',
  after: 'after',
  is_set: 'is set',
  is_not_set: 'is not set',
};

// The full catalog of filterable fields for a team. Recomputed when the team
// changes.
export function buildFieldSpecs(team: TeamDetail): FieldSpec[] {
  return [
    {
      field: 'status',
      label: 'State',
      kind: 'set',
      options: team.states.map((c) => ({ value: c.id, label: c.name, color: c.color })),
    },
    { field: 'statusType', label: 'State type', kind: 'set', options: STATE_TYPE_OPTIONS },
    {
      field: 'assignee',
      label: 'Assignee',
      kind: 'set',
      options: [
        ...team.assignees.map((a) => ({ value: a.userId, label: a.name })),
        { value: null, label: 'No assignee' },
      ],
    },
    {
      field: 'subscribers',
      label: 'Subscribers',
      kind: 'set',
      options: [
        { value: SUBSCRIBER_ME, label: 'Me' },
        ...team.assignees.map((a) => ({ value: a.userId, label: a.name })),
      ],
    },
    {
      field: 'delegate',
      label: 'Delegate',
      kind: 'set',
      // Delegates are Linear agent app users; none exist yet, so only "No delegate".
      options: [{ value: null, label: 'No delegate' }],
    },
    { field: 'priority', label: 'Priority', kind: 'set', options: PRIORITY_OPTIONS },
    ...(cyclesVisible(team)
      ? [
          {
            field: 'cycle',
            label: 'Cycle',
            kind: 'set' as const,
            options: [
              ...sortedCycles(knownCycles(team), new Date()).map((c) => ({
                value: c.id,
                label: cycleLabel(c),
              })),
              { value: null, label: 'No cycle' },
            ],
          },
        ]
      : []),
    {
      field: 'labels',
      label: 'Labels',
      kind: 'set',
      options: team.labels.map((l) => ({ value: l.id, label: l.name, color: l.color })),
    },
    { field: 'dueDate', label: 'Due date', kind: 'date' },
    { field: 'created', label: 'Created', kind: 'date' },
    { field: 'updated', label: 'Updated', kind: 'date' },
  ];
}

// A fresh condition for a newly picked field, with the kind's first operator and
// no values, so it is inert (see isEffectiveCondition) until the user fills it in.
export function newCondition(spec: FieldSpec): FilterCondition {
  return {
    id: crypto.randomUUID(),
    field: spec.field,
    op: OPERATORS_BY_KIND[spec.kind][0],
    values: [],
  };
}

// Short display of a condition's chosen values for the pill.
export function valuesLabel(spec: FieldSpec, cond: FilterCondition): string {
  if (cond.op === 'is_set' || cond.op === 'is_not_set') return '';
  if (cond.values.length === 0) return '…';
  if (spec.kind === 'set') {
    const opts = spec.options ?? [];
    const labels = cond.values.map((v) => opts.find((o) => o.value === v)?.label ?? String(v));
    return labels.length <= 2 ? labels.join(', ') : `${labels.length} selected`;
  }
  return String(cond.values[0] ?? '');
}

// Short human-readable labels for the effective conditions of a filter set, e.g.
// ["State is Done", "Priority is not Low"]. Half-built conditions (no values on a
// value-based operator) and conditions on unknown fields are skipped.
export function describeConditions(
  filters: FilterSet | null | undefined,
  team: TeamDetail,
): string[] {
  if (!filters) return [];
  const byField = new Map(buildFieldSpecs(team).map((s) => [s.field, s]));
  const out: string[] = [];
  for (const cond of filters.conditions) {
    const spec = byField.get(cond.field);
    if (!spec) continue;
    const presence = cond.op === 'is_set' || cond.op === 'is_not_set';
    if (!presence && cond.values.length === 0) continue;
    const op = OPERATOR_LABELS[cond.op];
    out.push(presence ? `${spec.label} ${op}` : `${spec.label} ${op} ${valuesLabel(spec, cond)}`);
  }
  return out;
}
