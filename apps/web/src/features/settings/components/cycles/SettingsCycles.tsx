import { Switch } from '@/components/ui/switch';
import type { CycleSettingsFormState } from '../../hooks/useCycleSettingsForm';
import CycleSettingRow from './CycleSettingRow';
import CycleNumberSelect from './CycleNumberSelect';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const range = (min: number, max: number) =>
  Array.from({ length: max - min + 1 }, (_, i) => min + i);
const weeks = (n: number) => (n === 1 ? '1 week' : `${n} weeks`);

// Linear's team cycle settings. The schedule fields show only while cycles are on.
// Only a team manager may edit; others see the values read-only.
export default function SettingsCycles({ form }: { form: CycleSettingsFormState }) {
  const { values, set, editable } = form;
  return (
    <section className="flex flex-col gap-4">
      <CycleSettingRow label="Enable cycles" hint="Plan work in repeating, time-boxed cycles.">
        <Switch
          checked={values.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
          disabled={!editable}
          aria-label="Enable cycles"
        />
      </CycleSettingRow>
      {values.enabled && (
        <>
          <CycleSettingRow label="Cycle length">
            <CycleNumberSelect
              label="Cycle length"
              value={values.duration}
              options={range(1, 8)}
              format={weeks}
              onChange={(duration) => set({ duration })}
              disabled={!editable}
            />
          </CycleSettingRow>
          <CycleSettingRow label="Cycle starts on" hint="Cycles start and end on UTC days.">
            <CycleNumberSelect
              label="Cycle start day"
              value={values.startDay}
              options={range(0, 6)}
              format={(d) => WEEKDAYS[d]}
              onChange={(startDay) => set({ startDay })}
              disabled={!editable}
            />
          </CycleSettingRow>
          <CycleSettingRow label="Cooldown" hint="A break between one cycle and the next.">
            <CycleNumberSelect
              label="Cooldown"
              value={values.cooldown}
              options={range(0, 3)}
              format={(n) => (n === 0 ? 'No cooldown' : weeks(n))}
              onChange={(cooldown) => set({ cooldown })}
              disabled={!editable}
            />
          </CycleSettingRow>
          <CycleSettingRow
            label="Upcoming cycles"
            hint="How many cycles are created ahead of the current one."
          >
            <CycleNumberSelect
              label="Upcoming cycles"
              value={values.upcomingCount}
              options={range(1, 10)}
              format={String}
              onChange={(upcomingCount) => set({ upcomingCount })}
              disabled={!editable}
            />
          </CycleSettingRow>
          <CycleSettingRow
            label="Add started issues to the current cycle"
            hint="An issue moved to a started state joins the current cycle."
          >
            <Switch
              checked={values.autoAssignStarted}
              onCheckedChange={(autoAssignStarted) => set({ autoAssignStarted })}
              disabled={!editable}
              aria-label="Add started issues to the current cycle"
            />
          </CycleSettingRow>
          <CycleSettingRow
            label="Add completed issues to the current cycle"
            hint="An issue completed outside a cycle joins the current cycle."
          >
            <Switch
              checked={values.autoAssignCompleted}
              onCheckedChange={(autoAssignCompleted) => set({ autoAssignCompleted })}
              disabled={!editable}
              aria-label="Add completed issues to the current cycle"
            />
          </CycleSettingRow>
        </>
      )}
    </section>
  );
}
