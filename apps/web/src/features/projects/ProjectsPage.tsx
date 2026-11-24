'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePermissions } from '@/hooks/usePermissions';
import {
  PROJECT_SORTS,
  type ProjectCounts,
  type ProjectSort,
  type ProjectStatus,
} from '@/types/project';
import { projectsTabPath, type ProjectsTab } from '@/utils/paths';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ProjectsList from './components/list/ProjectsList';
import CreateProjectDialog from './components/list/CreateProjectDialog';
import ProjectTabCount from './components/list/ProjectTabCount';
import ProjectTeamFilter from './components/list/ProjectTeamFilter';
import {
  useArchivedProjects,
  useProjectStatusCounts,
  useProjectsList,
} from './services/projectsList.service';
import { sortProjects } from './utils/projectList';

// One tab per lifecycle status, except the terminal statuses share a "Completed"
// tab. `statuses: undefined` means the tab takes every status.
const TABS: { value: ProjectsTab; label: string; statuses: ProjectStatus[] | undefined }[] = [
  { value: 'all', label: 'All projects', statuses: undefined },
  { value: 'backlog', label: 'Backlog', statuses: ['backlog'] },
  { value: 'planned', label: 'Planned', statuses: ['planned'] },
  { value: 'started', label: 'In Progress', statuses: ['started'] },
  { value: 'paused', label: 'Paused', statuses: ['paused'] },
  { value: 'completed', label: 'Completed', statuses: ['completed', 'canceled'] },
  { value: 'archived', label: 'Archived', statuses: undefined },
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
    case 'archived':
      return undefined;
  }
}

// A team's projects, one status tab at a time. The open tab is a route of its own and
// the sorting is a query parameter, so the list reopens as it was after a reload and
// can be shared as a link. Each tab loads 25 projects at a time ("Load more"), newest
// first, narrowed by the name search. A sort is applied in the browser, so while one
// is chosen every page is loaded first. The tab counts are counted separately so they
// stay correct however much of the list is loaded.
export default function ProjectsPage({ tab }: { tab: ProjectsTab }) {
  const { team } = useShell();
  const { can } = usePermissions();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText.trim(), 250) || undefined;

  // The list's team filter (null lists every team); the Shell's team is what the
  // create dialog preselects.
  const filterKey = searchParams.get('team');
  const teamKey = team?.team.key ?? null;
  const activeTab = TABS.find((t) => t.value === tab)!;

  // An unknown sort is no sort at all, and a direction on its own means nothing.
  const sort = PROJECT_SORTS.find((key) => key === searchParams.get('sort'));
  const sortDir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  const dir = sort ? sortDir : undefined;

  const isArchived = tab === 'archived';
  const query = useProjectsList(
    { teamKey: filterKey, statuses: activeTab.statuses, search },
    !isArchived,
  );
  const archived = useArchivedProjects({ teamKey: filterKey, search }, isArchived);
  const counts = useProjectStatusCounts(filterKey).data;

  // The browser sorts loaded rows only, so a sort loads the remaining pages.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (sort && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [sort, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!team) return null;

  const leadNames = new Map(team.assignees.map((a) => [a.userId, a.name]));
  const items = sortProjects(
    isArchived ? (archived.data ?? []) : query.items,
    sort,
    sortDir,
    (id) => (id ? (leadNames.get(id) ?? '') : ''),
  );

  const tabPath = projectsTabPath(filterKey, tab);

  const pushQuery = (params: URLSearchParams) => {
    const search = params.toString();
    router.push(search ? `${tabPath.split('?')[0]}?${search}` : tabPath.split('?')[0]);
  };

  // A tab is its own route and carries no query, so switching one drops the sorting
  // of the tab left behind.
  const changeTab = (next: ProjectsTab) => {
    router.push(projectsTabPath(filterKey, next));
  };

  // Re-selecting the sorted column flips its direction; a new column sorts ascending.
  const changeSort = (key: ProjectSort) => {
    const params = new URLSearchParams(searchParams);
    params.set('sort', key);
    params.set('dir', sort === key && sortDir === 'asc' ? 'desc' : 'asc');
    pushQuery(params);
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Projects</h1>
          <ProjectTeamFilter
            value={filterKey}
            onChange={(key) => router.push(projectsTabPath(key, tab))}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search projects"
              aria-label="Search projects"
              className="h-8 w-48 pl-7"
            />
          </div>
        </div>
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
        isLoading={isArchived ? archived.isLoading : query.isLoading}
        canCreate={can('projects', 'create')}
        onCreate={() => setCreating(true)}
        statusLabel={activeTab.statuses || isArchived ? activeTab.label : undefined}
        sort={sort}
        dir={dir}
        onSort={changeSort}
      />

      {!isArchived && query.hasNextPage && !sort && (
        <div className="flex justify-center px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      {creating && teamKey && (
        <CreateProjectDialog teamKey={teamKey} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
