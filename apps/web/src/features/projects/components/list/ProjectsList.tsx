import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import type { Project, ProjectSort } from '@/types/project';
import type { TeamDetail } from '@/types/team';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/common/page/EmptyState';
import ProjectRow from './ProjectRow';

// Columns in table order. A `sort` key marks the column as sortable (in the
// browser, over the loaded rows); progress and health are not sortable.
const COLUMNS: { label: string; sort?: ProjectSort }[] = [
  { label: 'Name', sort: 'name' },
  { label: 'Priority', sort: 'priority' },
  { label: 'Lead', sort: 'lead' },
  { label: 'Target', sort: 'targetDate' },
  { label: 'Progress' },
  { label: 'Health' },
];

export default function ProjectsList({
  projects,
  team,
  isLoading,
  canCreate,
  onCreate,
  statusLabel,
  sort,
  dir,
  onSort,
}: {
  projects: Project[];
  team: TeamDetail;
  isLoading: boolean;
  canCreate: boolean;
  onCreate: () => void;
  // The label of the open status tab, absent on the tab that lists every status.
  // An empty status tab is a filtered view, not a first run, so it says so.
  statusLabel: string | undefined;
  sort: ProjectSort | undefined;
  dir: 'asc' | 'desc' | undefined;
  onSort: (key: ProjectSort) => void;
}) {
  const ownerById = new Map(team.assignees.map((a) => [a.userId, a]));

  if (isLoading) return <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>;

  if (projects.length === 0) {
    if (statusLabel)
      return (
        <EmptyState
          title={`No ${statusLabel.toLowerCase()} projects`}
          description={
            statusLabel === 'Archived'
              ? 'Archived projects are listed here until they are unarchived.'
              : 'Projects move between tabs as their status changes.'
          }
        />
      );
    return (
      <EmptyState
        title="No projects yet"
        description="A project groups related issues under one goal."
      >
        {canCreate && (
          <Button size="sm" onClick={onCreate}>
            <Plus className="size-3.5" />
            New project
          </Button>
        )}
      </EmptyState>
    );
  }

  return (
    <div className="px-4 pb-2">
      <Table className="min-w-[880px] table-fixed">
        <colgroup>
          <col className="w-[34%]" />
          <col className="w-[10%]" />
          <col className="w-[22%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[10%]" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((col) => (
              <TableHead key={col.label} className="px-3 text-xs font-medium text-muted-foreground">
                {col.sort ? (
                  <button
                    type="button"
                    onClick={() => onSort(col.sort!)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {col.label}
                    {sort === col.sort &&
                      (dir === 'desc' ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronUp className="size-3.5" />
                      ))}
                  </button>
                ) : (
                  col.label
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((it) => (
            <ProjectRow
              key={it.id}
              project={it}
              teamKey={team.team.key}
              owner={it.leadUserId ? (ownerById.get(it.leadUserId) ?? null) : null}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
