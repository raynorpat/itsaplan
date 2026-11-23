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

// Why the API would refuse to archive this state, or null when it would not. The API
// keeps at least one active state of every type, so the last one cannot go.
export function stateRemovalBlock(
  state: { id: string; stateType: string },
  states: { id: string; stateType: string }[],
): string | null {
  const others = states.some((s) => s.id !== state.id && s.stateType === state.stateType);
  return others ? null : `The last ${state.stateType} state cannot be deleted`;
}

// `blocked` is the refusal from stateRemovalBlock: when set, nothing is moved.
export async function removeState(
  issueIds: string[],
  run: RemoveStateRun,
  blocked: string | null = null,
): Promise<RemoveStateResult> {
  if (blocked) throw new Error(blocked);
  const { done, failed } = await runBulk(issueIds, {
    size: BATCH_SIZE,
    runChunk: run.moveChunk,
    runOne: run.moveOne,
  });
  if (failed.length > 0) return { moved: done, failed, archived: false };
  await run.archive();
  return { moved: done, failed, archived: true };
}
