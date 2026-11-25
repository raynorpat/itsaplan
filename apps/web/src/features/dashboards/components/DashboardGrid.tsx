'use client';

import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { useDndSensors } from '@/lib/dnd';
import type { Widget } from '@/utils/dashboards/config';
import type { DashboardState } from '@/utils/dashboards/loads';
import { cn } from '@/lib/utils';
import { moveWidget, rowsOf } from '../utils/layout';
import type { WidgetActions } from './WidgetMenu';
import DashboardSortableWidget from './DashboardSortableWidget';
import WidgetCard from './WidgetCard';

// The widgets in rows: two half widgets side by side, a full widget alone. In edit
// mode each widget can be dragged into a new place and has its edit actions.
export default function DashboardGrid({
  widgets,
  dashboard,
  editing,
  onChange,
  onEdit,
}: {
  widgets: Widget[];
  dashboard: DashboardState;
  editing: boolean;
  onChange: (widgets: Widget[]) => void;
  onEdit: (widget: Widget) => void;
}) {
  const sensors = useDndSensors();
  const actionsFor = (w: Widget): WidgetActions | null =>
    editing
      ? {
          onEdit: () => onEdit(w),
          onRemove: () => onChange(widgets.filter((x) => x.id !== w.id)),
          onResize: (width) => onChange(widgets.map((x) => (x.id === w.id ? { ...x, width } : x))),
        }
      : null;
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = widgets.findIndex((w) => w.id === active.id);
    const to = widgets.findIndex((w) => w.id === over.id);
    onChange(moveWidget(widgets, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
        <div className="grid gap-4">
          {rowsOf(widgets).map((row) => (
            <div key={row[0]!.id} className="grid gap-4 lg:grid-cols-2">
              {row.map((w) => {
                const span = w.width === 'full' && 'lg:col-span-2';
                const card = (
                  <WidgetCard
                    widget={w}
                    dashboard={dashboard}
                    actions={actionsFor(w)}
                    className={cn(editing && 'pl-7')}
                  />
                );
                return editing ? (
                  <DashboardSortableWidget
                    key={w.id}
                    id={w.id}
                    title={w.config.title}
                    className={cn(span || undefined)}
                  >
                    {card}
                  </DashboardSortableWidget>
                ) : (
                  <div key={w.id} className={cn('min-w-0', span || undefined)}>
                    {card}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
