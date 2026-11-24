import type { ReactNode } from 'react';
import Link from 'next/link';
import type { View } from '@/types/team';
import { viewPath } from '@/utils/paths';
import { VIEWS } from '@/utils/viewTypes';
import { formatShortDate } from '@/utils/dates';
import Avatar from '@/components/common/Avatar';
import ViewTabLabel from '@/components/layout/ViewTabLabel';

// One saved view in a Views list: its icon and name (opening the team's issues with
// the view selected), then its layout, whether it is shared, its owner and when it
// last changed. `actions` is the row's menu, where the viewer may change the view.
export default function ViewRow({ view, actions }: { view: View; actions?: ReactNode }) {
  const layout = VIEWS.find((l) => l.value === view.display.layout);
  return (
    <div className="group flex items-center gap-3 border-b border-border/50 px-6 py-2 text-sm hover:bg-accent/40">
      <Link
        href={viewPath(view.teamKey, view.id)}
        className="flex min-w-0 flex-1 items-center gap-2 truncate text-foreground"
      >
        <ViewTabLabel view={view} />
      </Link>
      <span className="hidden w-20 shrink-0 text-muted-foreground sm:block">
        {layout?.label ?? 'List'}
      </span>
      <span className="hidden w-20 shrink-0 text-muted-foreground sm:block">
        {view.shared ? 'Shared' : 'Personal'}
      </span>
      <span className="flex w-6 shrink-0 justify-center">
        {view.owner && (
          <Avatar name={view.owner.name} image={view.owner.image} title={view.owner.name} />
        )}
      </span>
      <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {formatShortDate(view.updatedAt)}
      </span>
      <span className="flex w-6 shrink-0 justify-end">{actions}</span>
    </div>
  );
}
