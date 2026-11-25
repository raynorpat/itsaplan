'use client';

import { useState } from 'react';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  CycleFilter,
  DataKind,
  ProjectFilter,
  Widget,
  WidgetConfig,
  WidgetKind,
} from '@/utils/dashboards/config';
import type { FilterCondition } from '@/utils/filters';
import { withData, withKind } from '../utils/layout';
import DashboardSelect from './DashboardSelect';
import WidgetIssueFilter from './WidgetIssueFilter';
import WidgetMeasureFields from './WidgetMeasureFields';
import WidgetOtherFilter from './WidgetOtherFilter';
import WidgetTableFields from './WidgetTableFields';

const DATA: { value: DataKind; label: string }[] = [
  { value: 'issues', label: 'Issues' },
  { value: 'requests', label: 'Feedback requests' },
  { value: 'projects', label: 'Projects' },
  { value: 'cycles', label: 'Cycles' },
];

// Adds or edits one widget: title, data, display, filter, measure and split, and a
// table's columns. The dashboard is saved with the rest of edit mode.
export default function WidgetEditor({
  initial,
  adding,
  onSave,
  onClose,
}: {
  initial: Widget;
  adding: boolean;
  onSave: (widget: Widget) => void;
  onClose: () => void;
}) {
  const [widget, setWidget] = useState(initial);
  const { config } = widget;
  const patch = (p: Partial<WidgetConfig>) =>
    setWidget((w) => ({ ...w, config: { ...w.config, ...p } }));
  const issueLike = config.data === 'issues' || config.data === 'requests';

  return (
    <Modal title={adding ? 'Add widget' : 'Edit widget'} onClose={onClose} wide>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="widget-title">Title</Label>
          <Input
            id="widget-title"
            value={config.title}
            maxLength={120}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <DashboardSelect
            id="widget-data"
            label="Data"
            value={config.data}
            options={DATA}
            onChange={(v) => setWidget((w) => withData(w, v as DataKind))}
          />
          <DashboardSelect
            id="widget-kind"
            label="Display"
            value={widget.kind}
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'number', label: 'Number' },
              { value: 'table', label: 'Table' },
            ]}
            onChange={(v) => setWidget((w) => withKind(w, v as WidgetKind))}
          />
        </div>
        <WidgetMeasureFields kind={widget.kind} config={config} onChange={patch} />
        {widget.kind === 'table' && config.table && (
          <WidgetTableFields
            data={config.data}
            table={config.table}
            onChange={(table) => patch({ table })}
          />
        )}
        <div className="grid gap-1.5">
          <span className="text-xs text-muted-foreground">Filter</span>
          {issueLike ? (
            <WidgetIssueFilter
              conditions={config.filter as FilterCondition[]}
              onChange={(filter) => patch({ filter })}
            />
          ) : (
            <WidgetOtherFilter
              data={config.data as 'projects' | 'cycles'}
              filter={config.filter as ProjectFilter | CycleFilter}
              onChange={(filter) => patch({ filter })}
            />
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!config.title.trim()}
            onClick={() => onSave({ ...widget, config: { ...config, title: config.title.trim() } })}
          >
            {adding ? 'Add widget' : 'Save widget'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
