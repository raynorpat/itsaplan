'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useViewsQuery } from '@/services/views.service';
import { newViewPath } from '@/utils/paths';
import { EmptyState } from '@/components/common/page/EmptyState';
import { Button } from '@/components/ui/button';
import ViewRow from './components/ViewRow';
import ViewRowMenu from './components/ViewRowMenu';

// A team's saved views, most recently changed first. Opening one shows the team's
// issues with that view selected; New view starts a view from the team's issues.
export default function TeamViewsPage() {
  const { team } = useShell();
  const { can } = usePermissions();
  const teamKey = team?.team.key ?? null;
  const views = useViewsQuery(teamKey);
  if (!teamKey) return null;

  const list = [...(views.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const newView = can('views', 'create') && (
    <Button size="sm" variant="outline" asChild>
      <Link href={newViewPath(teamKey)}>
        <Plus className="size-3.5" /> New view
      </Link>
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold">Views</h1>
        {list.length > 0 && newView}
      </div>
      {views.isLoading ? (
        <p className="px-6 text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <EmptyState
          title="No views yet"
          description="A view saves a set of filters and a display for the team's issues."
        >
          {newView}
        </EmptyState>
      ) : (
        <div>
          {list.map((view) => (
            <ViewRow
              key={view.id}
              view={view}
              actions={
                <ViewRowMenu
                  view={view}
                  canEdit={can('views', 'edit')}
                  canDelete={can('views', 'delete')}
                />
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
