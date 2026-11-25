import Link from 'next/link';
import type { ColumnDef } from '@/utils/dashboards/config';
import type { TableRow } from '@/utils/dashboards/compute';

// The top rows of a table widget; a row with a link opens its issue, project or cycle.
export default function WidgetTable({ columns, rows }: { columns: ColumnDef[]; rows: TableRow[] }) {
  if (rows.length === 0)
    return <p className="py-6 text-sm text-muted-foreground">Nothing to show.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className="py-1 pr-3 text-left font-normal whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              {columns.map((c, i) => {
                const cell = r.cells[c.id];
                const text = cell == null ? '–' : String(cell);
                return (
                  <td key={c.id} className="py-1 pr-3 whitespace-nowrap tabular-nums">
                    {i === 0 && r.href ? (
                      <Link href={r.href} className="hover:underline">
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
