import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { useStripSortSensors } from '@/lib/dnd';
import { DISPLAY_PROPERTIES, type PropertyKey } from '@/utils/viewSettings';
import PropertyChip from '@/components/layout/PropertyChip';
import SortablePropertyChip from '@/components/layout/SortablePropertyChip';

// The Table view's Display-properties chips: enabled properties first as a
// horizontal sortable list (drag to reorder — this is the column order), then
// the not-yet-shown properties.
// Clicking an enabled chip removes it; clicking a disabled one adds it (to the
// end). onChange receives the new ordered `properties` list.
export default function TableProperties({
  available,
  properties,
  onChange,
}: {
  // The properties offered (DISPLAY_PROPERTIES, without the cycle while cycles are off).
  available: typeof DISPLAY_PROPERTIES;
  properties: PropertyKey[];
  onChange: (properties: PropertyKey[]) => void;
}) {
  const sensors = useStripSortSensors();
  const builtinLabels = new Map(available.map((p) => [p.value as PropertyKey, p.label]));
  const labelFor = (key: PropertyKey): string | null => builtinLabels.get(key) ?? null;

  // Enabled keys in display order, dropping any unknown key.
  const enabled = properties.filter((k) => labelFor(k) != null);
  const enabledSet = new Set(properties);
  const disabledBuiltins = available.filter((p) => !enabledSet.has(p.value));

  const toggle = (key: PropertyKey) =>
    onChange(enabledSet.has(key) ? properties.filter((p) => p !== key) : [...properties, key]);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = enabled.indexOf(active.id as PropertyKey);
    const to = enabled.indexOf(over.id as PropertyKey);
    if (from === -1 || to === -1) return;
    onChange(arrayMove(enabled, from, to));
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={enabled} strategy={rectSortingStrategy}>
          {enabled.map((key) => (
            <SortablePropertyChip
              key={key}
              id={key}
              label={labelFor(key)!}
              onClick={() => toggle(key)}
            />
          ))}
        </SortableContext>
      </DndContext>
      {disabledBuiltins.map((p) => (
        <PropertyChip key={p.value} label={p.label} on={false} onClick={() => toggle(p.value)} />
      ))}
    </>
  );
}
