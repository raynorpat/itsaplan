import type { ReleaseStage } from '@/services/releases.service';
import { stageOrder } from '@/utils/releases';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ReleaseStageBadge from '../ReleaseStageBadge';

// The release's stage, chosen from its pipeline's stages in workflow order. Moving to
// the completed stage completes the release.
export default function ReleaseStageSelect({
  stages,
  value,
  disabled,
  onChange,
}: {
  stages: ReleaseStage[];
  value: ReleaseStage;
  disabled: boolean;
  onChange: (stageId: string) => void;
}) {
  return (
    <Select value={value.id} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size="sm" className="h-8 w-44" aria-label="Stage">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {stageOrder(stages).map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <ReleaseStageBadge stage={s} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
