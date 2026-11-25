import { db, issue, workflowState } from '@repo/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { visibleTeamIds } from '../shared/access';
import { weighProgress, type Progress } from '../shared/progress';
import { inReleaseSql } from './issues';

// Linear's Release.currentProgress: the project progress rule (shared/progress.ts) over
// the release's active issues the viewer can see, with the issue count per state type.

export type ReleaseProgress = Progress & {
  stateTypeCounts: Record<'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled', number>;
};

export async function releaseProgress(
  releaseId: string,
  viewerId: string,
): Promise<ReleaseProgress> {
  const rows = await db
    .select({ estimate: issue.estimate, type: workflowState.stateType })
    .from(issue)
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(
      and(
        inReleaseSql(releaseId),
        inArray(issue.teamId, visibleTeamIds(viewerId)),
        isNull(issue.archivedAt),
      ),
    );
  const stateTypeCounts = { backlog: 0, unstarted: 0, started: 0, completed: 0, canceled: 0 };
  for (const r of rows) stateTypeCounts[r.type as keyof typeof stateTypeCounts] += 1;
  return { ...weighProgress(rows), stateTypeCounts };
}
