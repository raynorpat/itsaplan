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

const OPEN_STAGE_ORDER: Record<string, number> = { started: 0, planned: 1 };

// The releases an issue can be added to by hand: open ones (planned or started) it is
// not in yet; started before planned, releases in a frozen stage last, then by pipeline
// and release name.
export function openReleasesFor<
  R extends {
    id: string;
    name: string;
    version: string | null;
    stage: ReleaseStageLike;
    pipeline: { name: string };
  },
>(releases: R[], inReleaseIds: ReadonlySet<string>): R[] {
  return releases
    .filter((r) => r.stage.type in OPEN_STAGE_ORDER && !inReleaseIds.has(r.id))
    .sort(
      (a, b) =>
        Number(a.stage.frozen) - Number(b.stage.frozen) ||
        OPEN_STAGE_ORDER[a.stage.type]! - OPEN_STAGE_ORDER[b.stage.type]! ||
        a.pipeline.name.localeCompare(b.pipeline.name) ||
        releaseLabel(a).localeCompare(releaseLabel(b)),
    );
}

// The commit shown beside a release's version: its first 7 characters, or null when
// there is none or the version is already that commit (a continuous release's default).
export function shortCommit(commitSha: string | null, version: string | null): string | null {
  if (!commitSha) return null;
  const short = commitSha.slice(0, 7);
  return version && commitSha.startsWith(version) ? null : short;
}
