import { measureDef, SLICE_LABELS, type Widget } from '@/utils/dashboards/config';
import type { WidgetResult } from '@/utils/dashboards/compute';
import { overTimeStacked } from '../utils/layout';
import WidgetBars from './WidgetBars';
import WidgetNumber from './WidgetNumber';
import WidgetOverTime from './WidgetOverTime';
import WidgetTable from './WidgetTable';

// The figure part of a widget, by the shape its result takes.
export default function WidgetBody({
  widget,
  result,
  onSlice,
}: {
  widget: Widget;
  result: WidgetResult;
  onSlice: (key: string, label: string) => void;
}) {
  const unit = measureDef(widget.config.data, widget.config.measure)?.unit ?? 'count';
  switch (result.kind) {
    case 'bars':
      return (
        <WidgetBars
          rows={result.rows}
          unit={unit}
          sliceLabel={widget.config.slice ? (SLICE_LABELS[widget.config.slice] ?? '') : ''}
          onSlice={onSlice}
        />
      );
    case 'overTime':
      return (
        <WidgetOverTime
          series={result.series}
          weeks={result.weeks}
          line={widget.config.chart === 'overTimeLine'}
          stacked={overTimeStacked(widget)}
        />
      );
    case 'number':
      return <WidgetNumber value={result.value} previous={result.previous} unit={result.unit} />;
    case 'table':
      return <WidgetTable columns={result.columns} rows={result.rows} />;
  }
}
