import { DISPLAY_PROPERTIES, type PropertyKey, type ViewSettings } from '@/utils/viewSettings';
import { withoutCycleOptions } from '@/utils/cycles';
import PropertyChip from '@/components/layout/PropertyChip';

// The Display properties block: one on/off chip per property. The List and the
// Board place the enabled ones in their own fixed order.
export default function DisplayPropertiesSection({
  settings,
  onChange,
  cyclesOn,
}: {
  settings: ViewSettings;
  onChange: (patch: Partial<ViewSettings>) => void;
  cyclesOn: boolean;
}) {
  const properties = withoutCycleOptions(DISPLAY_PROPERTIES, cyclesOn);

  // Enabling appends; disabling removes.
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
        {properties.map((p) => (
          <PropertyChip
            key={p.value}
            label={p.label}
            on={settings.properties.includes(p.value)}
            onClick={() => toggleProperty(p.value)}
          />
        ))}
      </div>
    </div>
  );
}
