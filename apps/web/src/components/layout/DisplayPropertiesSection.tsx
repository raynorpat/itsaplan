import { DISPLAY_PROPERTIES, type PropertyKey, type ViewSettings } from '@/utils/viewSettings';
import type { WorkItemsView } from '@/utils/viewTypes';
import { withoutCycleOptions } from '@/utils/cycles';
import PropertyChip from '@/components/layout/PropertyChip';
import TableProperties from '@/components/layout/TableProperties';

// The Display properties block. On the Table layout the chips are the column
// list, sortable; on Team they are plain on/off chips.
export default function DisplayPropertiesSection({
  view,
  settings,
  onChange,
  cyclesOn,
}: {
  view: WorkItemsView;
  settings: ViewSettings;
  onChange: (patch: Partial<ViewSettings>) => void;
  cyclesOn: boolean;
}) {
  const properties = withoutCycleOptions(DISPLAY_PROPERTIES, cyclesOn);

  // Enabling appends to the end (a new column shows on the right); disabling
  // removes. Order is otherwise preserved.
  const toggleProperty = (property: PropertyKey) =>
    onChange({
      properties: settings.properties.includes(property)
        ? settings.properties.filter((p) => p !== property)
        : [...settings.properties, property],
    });

  return (
    <div className="space-y-3 border-t pt-2">
      <p className="px-1 text-xs font-medium text-muted-foreground">Display properties</p>
      <div className="flex flex-wrap items-center gap-1 px-1">
        {view === 'table' ? (
          <TableProperties
            available={properties}
            properties={settings.properties}
            onChange={(properties) => onChange({ properties })}
          />
        ) : (
          properties.map((p) => (
            <PropertyChip
              key={p.value}
              label={p.label}
              on={settings.properties.includes(p.value)}
              onClick={() => toggleProperty(p.value)}
            />
          ))
        )}
      </div>
    </div>
  );
}
