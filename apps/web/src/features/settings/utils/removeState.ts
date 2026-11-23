import { runBulk, type BulkResult } from '@/utils/bulk';

// Removing a state the way Linear does: its issues move to another state first, then
// the state is archived. The API refuses to archive a state that still holds active
// issues, so when any issue fails to move the state stays and the failures are
// returned for the caller to report.

export interface RemoveStateRun {
  // Moves a group of issues to the target state (issueBatchUpdate).
  moveChunk: (ids: string[]) => Promise<unknown>;
  // Moves one issue, used to find which issue of a refused group failed.
  moveOne: (id: string) => Promise<unknown>;
  archive: () => Promise<unknown>;
}

export interface RemoveStateResult {
  moved: string[];
  failed: BulkResult['failed'];
  archived: boolean;
}

const BATCH_SIZE = 50;

export async function removeState(
  issueIds: string[],
  run: RemoveStateRun,
): Promise<RemoveStateResult> {
  const { done, failed } = await runBulk(issueIds, {
    size: BATCH_SIZE,
    runChunk: run.moveChunk,
    runOne: run.moveOne,
  });
  if (failed.length > 0) return { moved: done, failed, archived: false };
  await run.archive();
  return { moved: done, failed, archived: true };
}
