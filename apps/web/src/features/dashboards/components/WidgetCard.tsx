'use client';

import { useState } from 'react';
import { sliceItems, type TableRow } from '@/utils/dashboards/compute';
import { toCsv } from '@/utils/dashboards/csv';
import type { Widget } from '@/utils/dashboards/config';
import type { DashboardState } from '@/utils/dashboards/loads';
import { cn } from '@/lib/utils';
import { useWidgetResult } from '../hooks/useWidgetResult';
import { csvFileName, downloadText } from '../utils/download';
import WidgetBody from './WidgetBody';
import WidgetMenu, { type WidgetActions } from './WidgetMenu';
import WidgetSlicePanel from './WidgetSlicePanel';

// One widget: its title and menu, its figures for the dashboard's period and team,
// the notes on cut or left-out rows, and the side panel of a clicked slice.
export default function WidgetCard({
  widget,
  dashboard,
  actions,
  className,
}: {
  widget: Widget;
  dashboard: DashboardState;
  actions: WidgetActions | null;
  className?: string;
}) {
  const { rows, ctx, result, isPending, error } = useWidgetResult(widget, dashboard, true);
  const [panel, setPanel] = useState<{ title: string; rows: TableRow[] } | null>(null);

  const openSlice = (key: string, label: string) => {
    if (!rows || !ctx) return;
    setPanel({
      title: `${widget.config.title}: ${label}`,
      rows: sliceItems(widget, rows, ctx, key),
    });
  };

  return (
    <section
      aria-label={widget.config.title}
      className={cn('flex min-w-0 flex-col rounded-lg border bg-card p-4', className)}
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-sm font-medium">{widget.config.title}</h2>
        <WidgetMenu
          widget={widget}
          actions={actions}
          onExport={
            result
              ? () => downloadText(csvFileName(widget.config.title), toCsv(widget, result))
              : null
          }
        />
      </header>
      {error ? (
        <p className="py-6 text-sm text-destructive">This widget could not be loaded.</p>
      ) : isPending || !result ? (
        <p className="py-6 text-sm text-muted-foreground">Loading…</p>
      ) : result.note ? (
        <p className="py-6 text-sm text-muted-foreground">{result.note}</p>
      ) : (
        <WidgetBody widget={widget} result={result} onSlice={openSlice} />
      )}
      {result && (result.capped || result.excluded > 0) && (
        <p className="mt-2 text-xs text-muted-foreground">
          {[
            result.capped ? 'Showing the first 5,000' : null,
            result.excluded > 0 ? `${result.excluded} left out (no start or end date)` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {panel && (
        <WidgetSlicePanel title={panel.title} rows={panel.rows} onClose={() => setPanel(null)} />
      )}
    </section>
  );
}
