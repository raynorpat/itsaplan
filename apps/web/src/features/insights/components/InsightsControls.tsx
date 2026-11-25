'use client';

import { X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { MEASURE_LABELS, PERIOD_LABELS, SLICE_LABELS } from '../utils/panel';
import { PERIODS, type InsightsSettings, type PeriodMonths } from '../utils/settings';
import type { Measure } from '@/utils/insights/measures';
import type { SliceField } from '@/utils/insights/slices';

const NONE = 'none';

function Choice<T extends string>({
  label,
  value,
  options,
  names,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  names: Record<string, string>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger size="sm" className="h-7 text-xs text-foreground" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="text-xs">
              {names[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

// The panel's header row: what to measure, how to slice and segment it, the period,
// the chart tab and Close.
export default function InsightsControls({
  settings,
  measures,
  fields,
  onChange,
  onClose,
}: {
  settings: InsightsSettings;
  measures: Measure[];
  fields: SliceField[];
  onChange: (patch: Partial<InsightsSettings>) => void;
  onClose: () => void;
}) {
  const segmentValue = settings.segment ?? NONE;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
      <Tabs
        value={settings.tab}
        onValueChange={(tab) => onChange({ tab: tab as InsightsSettings['tab'] })}
      >
        <TabsList className="h-7">
          <TabsTrigger value="breakdown" className="text-xs">
            Breakdown
          </TabsTrigger>
          <TabsTrigger value="overTime" className="text-xs">
            Over time
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {settings.tab === 'breakdown' && (
        <>
          <Choice
            label="Measure"
            value={settings.measure}
            options={measures}
            names={MEASURE_LABELS}
            onChange={(measure) => onChange({ measure })}
          />
          <Choice
            label="Slice by"
            value={settings.slice}
            options={fields}
            names={SLICE_LABELS}
            onChange={(slice) => onChange({ slice })}
          />
          <Choice
            label="Segment by"
            value={segmentValue}
            options={[NONE, ...fields.filter((f) => f !== settings.slice)]}
            names={{ ...SLICE_LABELS, [NONE]: 'None' }}
            onChange={(segment) => onChange({ segment: segment === NONE ? null : segment })}
          />
        </>
      )}
      <Choice
        label="Period"
        value={String(settings.periodMonths)}
        options={PERIODS.map(String)}
        names={PERIOD_LABELS as unknown as Record<string, string>}
        onChange={(p) => onChange({ periodMonths: Number(p) as PeriodMonths })}
      />
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto size-7 text-muted-foreground"
        onClick={onClose}
        aria-label="Close insights"
        title="Close insights"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
