'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  CUSTOMER_MEASURES,
  TABLE_COLUMNS,
  type DataKind,
  type TableConfig,
} from '@/utils/dashboards/config';
import DashboardSelect from './DashboardSelect';

// A table widget's columns, number of rows (5 to 50) and sort; the customer columns of
// issues and requests only while Customers is on.
export default function WidgetTableFields({
  data,
  table,
  customersOn,
  onChange,
}: {
  data: DataKind;
  table: TableConfig;
  customersOn: boolean;
  onChange: (table: TableConfig) => void;
}) {
  const all = TABLE_COLUMNS[data].filter((c) => customersOn || !CUSTOMER_MEASURES.has(c.id));
  const [sortColumn = '', direction = 'desc'] = table.sort.split(':');
  const toggle = (id: string) => {
    const columns = table.columns.includes(id)
      ? table.columns.filter((c) => c !== id)
      : all.map((c) => c.id).filter((c) => c === id || table.columns.includes(c));
    if (columns.length > 0) onChange({ ...table, columns });
  };
  return (
    <div className="grid gap-3">
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="mb-1 text-xs text-muted-foreground">Columns</legend>
        {all.map((c) => (
          <label key={c.id} className="flex items-center gap-1.5">
            <Checkbox checked={table.columns.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
            {c.label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          Rows
          <Input
            type="number"
            min={5}
            max={50}
            className="h-8 w-20"
            value={table.limit}
            onChange={(e) =>
              onChange({ ...table, limit: Math.min(50, Math.max(5, Number(e.target.value) || 10)) })
            }
          />
        </label>
        <DashboardSelect
          id="widget-sort"
          label="Sort by"
          value={sortColumn}
          options={all.map((c) => ({ value: c.id, label: `Sort by ${c.label}` }))}
          onChange={(v) => onChange({ ...table, sort: `${v}:${direction}` })}
        />
        <DashboardSelect
          id="widget-sort-direction"
          label="Sort direction"
          value={direction}
          className="w-32"
          options={[
            { value: 'desc', label: 'Highest first' },
            { value: 'asc', label: 'Lowest first' },
          ]}
          onChange={(v) => onChange({ ...table, sort: `${sortColumn}:${v}` })}
        />
      </div>
    </div>
  );
}
