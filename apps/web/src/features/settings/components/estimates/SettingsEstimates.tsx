import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ESTIMATION_TYPES, estimateOptions, type EstimationType } from '@/utils/estimates';
import type { EstimateSettingsFormState } from '../../hooks/useEstimateSettingsForm';
import SettingRow from '../SettingRow';

// Linear's team estimate settings: the scale, its extended points and zero, and what an
// unestimated issue counts as in progress. The options show only while a scale is in
// use. Only a team manager may edit; others see the values read-only.
export default function SettingsEstimates({ form }: { form: EstimateSettingsFormState }) {
  const { values, set, editable } = form;
  const used = values.type !== 'notUsed';
  const scale = estimateOptions(values)
    .map((o) => o.label)
    .join(', ');
  return (
    <section className="flex flex-col gap-4">
      <SettingRow label="Estimate scale" hint={used ? `Issues take ${scale}.` : undefined}>
        <Select
          value={values.type}
          onValueChange={(type) => set({ type: type as EstimationType })}
          disabled={!editable}
        >
          <SelectTrigger size="sm" className="h-8 w-60" aria-label="Estimate scale">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ESTIMATION_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      {used && (
        <>
          <SettingRow label="Extended scale" hint="Add two larger points to the scale.">
            <Switch
              checked={values.extended}
              onCheckedChange={(extended) => set({ extended })}
              disabled={!editable}
              aria-label="Extended scale"
            />
          </SettingRow>
          <SettingRow label="Allow zero" hint="Let issues be estimated as 0.">
            <Switch
              checked={values.allowZero}
              onCheckedChange={(allowZero) => set({ allowZero })}
              disabled={!editable}
              aria-label="Allow zero"
            />
          </SettingRow>
          <SettingRow
            label="Default estimate"
            hint="What an unestimated issue counts as in cycle and project progress."
          >
            <Input
              inputMode="decimal"
              value={form.defaultText}
              onChange={(e) => form.setDefaultText(e.target.value)}
              disabled={!editable}
              aria-label="Default estimate"
              className="h-8 w-24"
            />
          </SettingRow>
        </>
      )}
    </section>
  );
}
