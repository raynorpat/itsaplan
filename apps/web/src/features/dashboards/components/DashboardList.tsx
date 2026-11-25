import Link from 'next/link';
import { formatShortDate } from '@/utils/dates';
import { dashboardPath } from '@/utils/paths';
import type { DashboardSummary } from '../services/dashboards.service';

const sharing = (d: DashboardSummary) =>
  d.sharedWith === 'workspace'
    ? 'Workspace'
    : `${d.teamIds.length} ${d.teamIds.length === 1 ? 'team' : 'teams'}`;

// The dashboards list: name, owner, who it is shared with and when it last changed.
export default function DashboardList({ dashboards }: { dashboards: DashboardSummary[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr className="border-b">
          <th scope="col" className="px-4 py-2 text-left font-normal">
            Name
          </th>
          <th scope="col" className="px-4 py-2 text-left font-normal">
            Owner
          </th>
          <th scope="col" className="px-4 py-2 text-left font-normal">
            Shared with
          </th>
          <th scope="col" className="px-4 py-2 text-right font-normal">
            Updated
          </th>
        </tr>
      </thead>
      <tbody>
        {dashboards.map((d) => (
          <tr key={d.id} className="border-b hover:bg-accent/50">
            <td className="px-4 py-2">
              <Link href={dashboardPath(d.id)} className="font-medium hover:underline">
                {d.name}
              </Link>
            </td>
            <td className="px-4 py-2 text-muted-foreground">{d.ownerName ?? 'No owner'}</td>
            <td className="px-4 py-2 text-muted-foreground">{sharing(d)}</td>
            <td className="px-4 py-2 text-right text-muted-foreground tabular-nums">
              {formatShortDate(d.updatedAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
