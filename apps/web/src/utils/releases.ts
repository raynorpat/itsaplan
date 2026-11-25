// Release tracking helpers shared by the release pages, the issue's Release property
// and the release settings.

export interface ReleaseStageLike {
  id: string;
  name: string;
  type: string;
  color: string;
  position: number;
  frozen: boolean;
}

const STAGE_TYPE_ORDER: Record<string, number> = {
  planned: 0,
  started: 1,
  completed: 2,
  canceled: 3,
};

// A pipeline's stages in workflow order: planned, the started stages by position,
// completed, canceled.
export function stageOrder<S extends ReleaseStageLike>(stages: S[]): S[] {
  return [...stages].sort(
    (a, b) =>
      (STAGE_TYPE_ORDER[a.type] ?? 9) - (STAGE_TYPE_ORDER[b.type] ?? 9) || a.position - b.position,
  );
}

// What a release is called on screen: its name, else its version (a continuous
// release is often only a commit).
export function releaseLabel(r: { name: string; version: string | null }): string {
  return r.name.trim() || r.version?.trim() || 'Untitled release';
}
