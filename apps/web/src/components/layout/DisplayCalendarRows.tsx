import { rememberWeekStart, type ViewSettings, type WeekStart } from '@/utils/viewSettings';
import DisplaySettingsRow from '@/components/layout/DisplaySettingsRow';
import DisplaySettingsSelect from '@/components/layout/DisplaySettingsSelect';

const WEEK_START_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
];

// The Display settings rows that only apply to the Calendar layout.
export default function DisplayCalendarRows({
  settings,
  onChange,
}: {
  settings: ViewSettings;
  onChange: (patch: Partial<ViewSettings>) => void;
}) {
  return (
    <>
      <DisplaySettingsRow label="Start week on">
        <DisplaySettingsSelect
          value={String(settings.weekStart)}
          onChange={(v) => {
            const weekStart = Number(v) as WeekStart;
            rememberWeekStart(weekStart);
            onChange({ weekStart });
          }}
          options={WEEK_START_OPTIONS}
        />
      </DisplaySettingsRow>
    </>
  );
}
