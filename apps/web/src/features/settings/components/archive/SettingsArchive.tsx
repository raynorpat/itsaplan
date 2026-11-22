import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AUTO_ARCHIVE_PERIODS } from '@/lib/api';
import type { AutoArchiveForm } from '../../hooks/useAutoArchiveForm';

const periodLabel = (months: number) =>
  months === 0 ? 'Never' : months === 1 ? 'After 1 month' : `After ${months} months`;

// Linear's auto-archive period: completed and canceled issues are archived this long
// after they were closed. Only a team manager may edit; others see it read-only.
export default function SettingsArchive({ form }: { form: AutoArchiveForm }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
        <span className="flex-1 text-sm">Archive closed issues</span>
        <Select
          value={String(form.period)}
          onValueChange={(v) => form.setPeriod(Number(v))}
          disabled={!form.editable}
        >
          <SelectTrigger size="sm" className="h-8 w-44" aria-label="Auto-archive period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTO_ARCHIVE_PERIODS.map((months) => (
              <SelectItem key={months} value={String(months)}>
                {periodLabel(months)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
