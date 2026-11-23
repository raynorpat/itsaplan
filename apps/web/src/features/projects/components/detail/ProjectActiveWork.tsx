'use client';

import { useMemo } from 'react';
import type { TeamDetail } from '@/lib/api';
import { useShell } from '@/context/shellContext';
import { StateIcon } from '@/components/common/issue/IssueIcons';
import Avatar from '@/components/common/Avatar';

// The project's issues currently in progress (state group 'started'), listed so
// the overview shows what is actively being worked on, not just the counts.
export default function ProjectActiveWork({
  team,
  projectId,
}: {
  team: TeamDetail;
  projectId: string;
}) {
  const { onOpenIssue } = useShell();

  const rows = useMemo(() => {
    const columns = new Map(team.states.map((c) => [c.id, c]));
    return team.issues
      .filter((i) => i.project?.id === projectId)
      .map((issue) => ({ issue, column: columns.get(issue.stateId) }))
      .filter((row) => row.column?.stateType === 'started');
  }, [team.states, team.issues, projectId]);

  if (rows.length === 0) return null;

  const assignees = new Map(team.assignees.map((a) => [a.userId, a]));

  return (
    <div className="mt-8">
      <h3 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        In progress <span className="tabular-nums">· {rows.length}</span>
      </h3>
      <ul className="divide-border overflow-hidden rounded-lg border">
        {rows.map(({ issue, column }) => {
          const owner = issue.assigneeUserId ? assignees.get(issue.assigneeUserId) : null;
          return (
            <li key={issue.id} className="border-border not-last:border-b">
              <button
                type="button"
                onClick={() => onOpenIssue(issue.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted/50"
              >
                {column && (
                  <StateIcon
                    stateType={column.stateType}
                    color={column.color}
                    className="size-3.5 shrink-0"
                  />
                )}
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {issue.identifier}
                </span>
                <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                {owner && (
                  <Avatar
                    name={owner.name}
                    image={owner.image}
                    className="size-5 shrink-0 text-[8px]"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
