import { COMPLETED_WINDOWS, type CompletedWindow } from '@/utils/completedIssues';
import type { ViewSettings } from '@/utils/viewSettings';
import { Switch } from '@/components/ui/switch';
import DisplaySettingsRow from '@/components/layout/DisplaySettingsRow';
import DisplaySettingsSelect from '@/components/layout/DisplaySettingsSelect';

// Which issues the layout shows (Linear's "Completed issues" and "Show sub-issues"),
// applied to every layout.
export default function DisplayIssueRows({
  settings,
  onChange,
}: {
  settings: ViewSettings;
  onChange: (patch: Partial<ViewSettings>) => void;
}) {
  return (
    <>
      <DisplaySettingsRow label="Completed issues">
        <DisplaySettingsSelect
          value={settings.completedIssues}
          onChange={(v) => onChange({ completedIssues: v as CompletedWindow })}
          options={COMPLETED_WINDOWS}
        />
      </DisplaySettingsRow>
      <DisplaySettingsRow label="Show sub-issues">
        <Switch
          checked={settings.showSubIssues}
          onCheckedChange={(checked) => onChange({ showSubIssues: checked })}
        />
      </DisplaySettingsRow>
    </>
  );
}
