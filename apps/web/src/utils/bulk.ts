// Bulk actions over a board selection: the ids split into groups the API takes in one
// call, and per-issue failures reported so the rest stays applied.

export function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

export interface BulkResult {
  done: string[];
  failed: { id: string; message: string }[];
}

interface BulkRun {
  size: number;
  // One call for a whole group (e.g. issueBatchUpdate). The API refuses the group as a
  // whole when one of its issues is refused, so a failed group is retried one issue
  // at a time with `runOne` to find exactly which issue failed.
  runChunk?: (ids: string[]) => Promise<unknown>;
  runOne: (id: string) => Promise<unknown>;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runBulk(ids: string[], run: BulkRun): Promise<BulkResult> {
  const result: BulkResult = { done: [], failed: [] };
  const one = async (id: string) => {
    try {
      await run.runOne(id);
      result.done.push(id);
    } catch (err) {
      result.failed.push({ id, message: messageOf(err) });
    }
  };
  for (const group of chunk(ids, run.size)) {
    if (!run.runChunk) {
      for (const id of group) await one(id);
      continue;
    }
    try {
      await run.runChunk(group);
      result.done.push(...group);
    } catch {
      for (const id of group) await one(id);
    }
  }
  return result;
}
