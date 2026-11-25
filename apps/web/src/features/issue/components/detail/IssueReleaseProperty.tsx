import { Rocket } from 'lucide-react';
import { Pill } from '@/components/common/fields/Pill';
import PopoverPick, { type PickItem } from '@/components/common/fields/PopoverPick';
import {
  useIssueReleases,
  useReleaseWrites,
  useTeamOpenReleases,
  useTeamPipelines,
  type IssueRelease,
} from '@/services/releases.service';
import { openReleasesFor, releaseLabel } from '@/utils/releases';

const icon = <Rocket className="size-3.5" />;
const dot = (color: string) => (
  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
);
const itemLabel = (r: IssueRelease) => `${r.pipeline.name} · ${releaseLabel(r)}`;

// The issue's Release property: the releases it is in (each as "<pipeline> ·
// <release>" with its stage colour), removable, and the open releases of the team's
// pipelines to add it to. Hidden while the team has no pipeline and the issue is in no
// release; read-only for guests.
export default function IssueReleaseProperty({
  issueId,
  teamId,
  readOnly,
}: {
  issueId: string;
  teamId: string;
  readOnly?: boolean;
}) {
  const pipelines = useTeamPipelines(teamId);
  const current = useIssueReleases(issueId).data ?? [];
  const open = useTeamOpenReleases(teamId, !readOnly).data ?? [];
  const { addIssue, removeIssue } = useReleaseWrites();
  if ((pipelines.data ?? []).length === 0 && current.length === 0) return null;

  const first = current[0];
  const trigger = (
    <Pill active={!!first}>
      {first ? dot(first.stage.color) : icon}
      {first ? itemLabel(first) : 'Release'}
      {current.length > 1 && <span className="text-muted-foreground">+{current.length - 1}</span>}
    </Pill>
  );

  const inRelease = new Set(current.map((r) => r.id));
  const items: PickItem[] = [
    ...current.map((r) => ({
      key: r.id,
      search: itemLabel(r),
      icon: dot(r.stage.color),
      label: itemLabel(r),
      selected: true,
      onSelect: () => removeIssue.mutate({ issueId, releaseId: r.id }),
    })),
    ...openReleasesFor(open, inRelease).map((r) => ({
      key: r.id,
      search: itemLabel(r),
      icon: dot(r.stage.color),
      label: r.stage.frozen ? `${itemLabel(r)} · ${r.stage.name}` : itemLabel(r),
      selected: false,
      onSelect: () => addIssue.mutate({ issueId, releaseId: r.id }),
    })),
  ];

  return (
    <PopoverPick
      readOnly={readOnly}
      trigger={trigger}
      inputPlaceholder="Add to release…"
      emptyText="No open releases"
      items={items}
    />
  );
}
