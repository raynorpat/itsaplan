import { ArrowDown, ArrowUp, Snowflake, Trash2 } from 'lucide-react';
import ColorField from '@/components/common/fields/ColorField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { ReleaseStageLike } from '@/utils/releases';
import type { StageInput } from '../services/releasesSettings.service';

const TYPE_LABELS: Record<string, string> = {
  planned: 'Planned',
  started: 'In progress',
  completed: 'Completed',
  canceled: 'Canceled',
};

// One stage: colour, name (saved on blur), its type, the frozen switch, and for
// in-progress stages Move up / Move down and Archive when given.
export default function PipelineStageRow({
  stage,
  canEdit,
  onChange,
  onMoveUp,
  onMoveDown,
  onArchive,
}: {
  stage: ReleaseStageLike;
  canEdit: boolean;
  onChange: (input: StageInput) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onArchive?: () => void;
}) {
  if (!canEdit)
    return (
      <li className="flex items-center gap-2 px-3 py-2 text-sm">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
        {stage.name}
        <span className="text-xs text-muted-foreground">{TYPE_LABELS[stage.type]}</span>
        {stage.frozen && (
          <Snowflake className="size-3.5 text-muted-foreground" aria-label="Frozen" />
        )}
      </li>
    );

  return (
    <li className="flex items-center gap-2 px-3 py-1.5">
      <ColorField value={stage.color} onChange={(color) => onChange({ color })} />
      <Input
        aria-label="Stage name"
        defaultValue={stage.name}
        className="h-8 max-w-56"
        onBlur={(e) => {
          const name = e.target.value.trim();
          if (name && name !== stage.name) onChange({ name });
          else e.target.value = stage.name;
        }}
      />
      <span className="w-20 text-xs text-muted-foreground">{TYPE_LABELS[stage.type]}</span>
      <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        <Snowflake className="size-3.5" aria-hidden />
        Frozen
        <Switch checked={stage.frozen} onCheckedChange={(frozen) => onChange({ frozen })} />
      </label>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Move up"
        disabled={!onMoveUp}
        onClick={onMoveUp}
      >
        <ArrowUp className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Move down"
        disabled={!onMoveDown}
        onClick={onMoveDown}
      >
        <ArrowDown className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Archive stage"
        disabled={!onArchive}
        onClick={onArchive}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}
