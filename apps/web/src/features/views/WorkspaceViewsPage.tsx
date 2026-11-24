'use client';

import Link from 'next/link';
import { useAllViewsQuery } from '@/services/views.service';
import { teamViewsPath } from '@/utils/paths';
import { EmptyState } from '@/components/common/page/EmptyState';
import ViewRow from './components/ViewRow';
import { viewsByTeam } from './utils/viewsByTeam';

// Every saved view the viewer can see, one section per team. A view is changed from
// its team's Views page, where the team's rights apply.
export default function WorkspaceViewsPage() {
  const views = useAllViewsQuery();
  const sections = viewsByTeam(views.data ?? []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <h1 className="px-6 py-4 text-lg font-semibold">Views</h1>
      {views.isLoading ? (
        <p className="px-6 text-sm text-muted-foreground">Loading…</p>
      ) : sections.length === 0 ? (
        <EmptyState
          title="No views yet"
          description="Views are saved from a team's issues. They show up here for every team you can see."
        />
      ) : (
        <div className="flex flex-col gap-6 pb-8">
          {sections.map((section) => (
            <section key={section.teamKey}>
              <Link
                href={teamViewsPath(section.teamKey)}
                className="block px-6 pb-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {section.teamName}
              </Link>
              {section.views.map((view) => (
                <ViewRow key={view.id} view={view} />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
