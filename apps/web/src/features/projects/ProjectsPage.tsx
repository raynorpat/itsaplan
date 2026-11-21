'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectCountsQuery, useProjectsQuery } from '@/services/projects.service';
import { PROJECT_SORTS, type ProjectCounts, type ProjectSort, type ProjectStatus } from '@/lib/api';
import { projectsTabPath, type ProjectsTab } from '@/utils/paths';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ProjectsList from './components/list/ProjectsList';
import ProjectsPagination from './components/list/ProjectsPagination';
import CreateProjectDialog from './components/list/CreateProjectDialog';
import ProjectTabCount from './components/list/ProjectTabCount';

const PAGE_SIZE = 25;

// One tab per lifecycle status, except the terminal statuses share a "Completed"
// tab. `statuses: undefined` means the tab takes every status.
const TABS: { value: ProjectsTab; label: string; statuses: ProjectStatus[] | undefined }[] = [
  { value: 'all', label: 'All projects', statuses: undefined },
  { value: 'backlog', label: 'Backlog', statuses: ['backlog'] },
  { value: 'planned', label: 'Planned', statuses: ['planned'] },
  { value: 'started', label: 'In Progress', statuses: ['started'] },
  { value: 'paused', label: 'Paused', statuses: ['paused'] },
  { value: 'completed', label: 'Completed', statuses: ['completed', 'canceled'] },
];

// The "Completed" tab groups the two terminal statuses, so its count sums them.
function tabCount(counts: ProjectCounts | undefined, tab: ProjectsTab): number | undefined {
  if (!counts) return undefined;
  switch (tab) {
    case 'all':
      return counts.total;
    case 'backlog':
      return counts.backlog;
    case 'planned':
      return counts.planned;
    case 'started':
      return counts.started;
    case 'paused':
      return counts.paused;
    case 'completed':
      return counts.completed + counts.canceled;
  }
}

// A team's projects, one status tab at a time. The open tab is a route of its
// own and the page and sorting are query parameters, so the list reopens as it was
// after a reload and can be shared as a link. Each tab loads its own page from the
// server, sorted and paged there; the tab counts come from a separate aggregate so
// they stay correct regardless of the current page.
export default function ProjectsPage({ tab }: { tab: ProjectsTab }) {
  const { team } = useShell();
  const { can } = usePermissions();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState(false);

  const teamKey = team?.team.key ?? null;
  const activeTab = TABS.find((t) => t.value === tab)!;

  const pageParam = Number(searchParams.get('page'));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  // A sort the server does not support is no sort at all, and a direction on its own
  // means nothing.
  const sort = PROJECT_SORTS.find((key) => key === searchParams.get('sort'));
  const sortDir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  const dir = sort ? sortDir : undefined;

  const query = useProjectsQuery(teamKey, {
    statuses: activeTab.statuses,
    sort,
    dir,
    page,
    pageSize: PAGE_SIZE,
  });
  const counts = useProjectCountsQuery(teamKey).data;

  if (!team) return null;

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const tabPath = projectsTabPath(team.team.key, tab);

  const pushQuery = (params: URLSearchParams) => {
    const search = params.toString();
    router.push(search ? `${tabPath}?${search}` : tabPath);
  };

  // A tab is its own route and carries no query, so switching one drops the page and
  // the sorting of the tab left behind.
  const changeTab = (next: ProjectsTab) => {
    router.push(projectsTabPath(team.team.key, next));
  };

  const changePage = (next: number) => {
    const params = new URLSearchParams(searchParams);
    if (next > 1) params.set('page', String(next));
    else params.delete('page');
    pushQuery(params);
  };

  // Re-selecting the sorted column flips its direction; a new column sorts ascending.
  const changeSort = (key: ProjectSort) => {
    const params = new URLSearchParams(searchParams);
    params.set('sort', key);
    params.set('dir', sort === key && sortDir === 'asc' ? 'desc' : 'asc');
    params.delete('page');
    pushQuery(params);
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold">Projects</h1>
        {can('projects', 'create') && (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            New project
          </Button>
        )}
      </div>

      <div className="px-4 pb-2">
        <Tabs value={tab} onValueChange={(v) => changeTab(v as ProjectsTab)}>
          <TabsList variant="line">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                <ProjectTabCount value={tabCount(counts, t.value)} />
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <ProjectsList
        projects={items}
        team={team}
        isLoading={query.isLoading}
        canCreate={can('projects', 'create')}
        onCreate={() => setCreating(true)}
        statusLabel={activeTab.statuses ? activeTab.label : undefined}
        sort={sort}
        dir={dir}
        onSort={changeSort}
      />

      <ProjectsPagination page={page} pageSize={PAGE_SIZE} total={total} onPage={changePage} />

      {creating && teamKey && (
        <CreateProjectDialog teamKey={teamKey} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
