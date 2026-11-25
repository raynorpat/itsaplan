'use client';

import { useState } from 'react';
import { useCustomersSettings } from '@/services/customers.service';
import { sliceItems, type TableRow } from '@/utils/dashboards/compute';
import { toCsv } from '@/utils/dashboards/csv';
import { requiresCustomers, type Widget } from '@/utils/dashboards/config';
import type { DashboardState } from '@/utils/dashboards/loads';
import { cn } from '@/lib/utils';
import { useWidgetResult } from '../hooks/useWidgetResult';
import { csvFileName, downloadText } from '../utils/download';
import { excludedText } from '../utils/format';
import WidgetBody from './WidgetBody';
import WidgetMenu, { type WidgetActions } from './WidgetMenu';
import WidgetSlicePanel from './WidgetSlicePanel';

// One widget: its title and menu, its figures for the dashboard's period and team,
// the notes on cut or left-out rows, and the side panel of a clicked slice. A widget of
// customer data loads nothing until Customers is known to be on.
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
  const settings = useCustomersSettings();
  const needsCustomers = requiresCustomers(widget.config);
  const customersOff = needsCustomers && settings.data?.enabled === false;
  const { rows, ctx, result, isPending, error } = useWidgetResult(
    widget,
    dashboard,
    !needsCustomers || settings.data?.enabled === true,
  );
  // A customer widget waits for the Customers switch; when it cannot be read the widget
  // cannot load either.
  const failed = error || (needsCustomers && settings.isError);
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
            result && !customersOff
              ? () => downloadText(csvFileName(widget.config.title), toCsv(widget, result))
              : null
          }
        />
      </header>
      {customersOff ? (
        <p className="py-6 text-sm text-muted-foreground">Customers are off</p>
      ) : failed ? (
        <p className="py-6 text-sm text-destructive">This widget could not be loaded.</p>
      ) : isPending || !result ? (
        <p className="py-6 text-sm text-muted-foreground">Loading…</p>
      ) : result.note ? (
        <p className="py-6 text-sm text-muted-foreground">{result.note}</p>
      ) : (
        <WidgetBody widget={widget} result={result} onSlice={openSlice} />
      )}
      {result && !customersOff && (result.capped || result.excluded > 0) && (
        <p className="mt-2 text-xs text-muted-foreground">
          {[
            result.capped ? 'Showing the first 5,000' : null,
            result.excluded > 0 ? excludedText(widget.config.measure, result.excluded) : null,
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
