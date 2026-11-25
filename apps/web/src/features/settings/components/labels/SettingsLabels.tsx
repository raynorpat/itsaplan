import { useState } from 'react';
import { splitLabels } from '@/utils/labels';
import { DndContext, DragOverlay, type DragEndEvent } from '@dnd-kit/core';
import type { Label as LabelRow, LabelGroup } from '@/types/team';
import { useDndSensors } from '@/lib/dnd';
import { DEFAULT_COLOR } from '@/utils/team';
import { colorDot } from '@/components/common/fields/colorDot';
import ColorField from '@/components/common/fields/ColorField';
import { SettingsInlineForm } from '../crud/SettingsInlineForm';
import { useSettingsCan } from '../../context/settingsPermission';
import {
  useCreateLabel,
  useCreateLabelGroup,
  useDeleteLabel,
  useDeleteLabelGroup,
  useRestoreLabel,
  useRetireLabel,
  useUpdateLabel,
  useUpdateLabelGroup,
} from '../../services/settings.service';
import { SettingsDraggableLabelRow } from './SettingsDraggableLabelRow';
import {
  SettingsLabelDeleteDialog,
  SettingsLabelGroupDeleteDialog,
} from './SettingsLabelDeleteDialogs';
import { SettingsLabelGroupSection } from './SettingsLabelGroupSection';
import { SettingsLabelsAddMenu } from './SettingsLabelsAddMenu';

// A tree of labels: each group is a collapsible node holding its labels, and
// ungrouped labels sit directly at the root alongside the groups. A group's header
// adds labels into that group; the "Add" action below the list adds a group or an
// ungrouped label. Labels drag between groups and the root. A team's page passes its
// own labels and `teamKey`; the workspace page passes the labels without a team and a
// null `teamKey`. `issueCount` is known only for a team (its loaded issues).
export default function SettingsLabels({
  teamKey,
  labels: allLabels,
  groups: ownGroups,
  issueCount,
}: {
  teamKey: string | null;
  labels: LabelRow[];
  groups: LabelGroup[];
  issueCount?: (labelId: string) => number;
}) {
  // Retired labels are listed apart, under the groups, with Restore.
  const { active: ownLabels, retired: retiredLabels } = splitLabels(allLabels);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // The open label add/edit form, and the open group add/edit form. At most one is
  // set at a time (opening either closes the other).
  const [labelForm, setLabelForm] = useState<
    { mode: 'add'; groupId: string | null } | { mode: 'edit'; id: string } | null
  >(null);
  const [lName, setLName] = useState('');
  const [lColor, setLColor] = useState(DEFAULT_COLOR);
  const [lGroupId, setLGroupId] = useState<string | null>(null);
  const [groupForm, setGroupForm] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(
    null,
  );
  const [gName, setGName] = useState('');
  const [gColor, setGColor] = useState(DEFAULT_COLOR);
  const [deletingLabel, setDeletingLabel] = useState<LabelRow | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<LabelGroup | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const can = useSettingsCan();
  const sensors = useDndSensors();

  const createLabel = useCreateLabel(teamKey);
  const updateLabel = useUpdateLabel(teamKey);
  const deleteLabel = useDeleteLabel(teamKey);
  const createLabelGroup = useCreateLabelGroup(teamKey);
  const updateLabelGroup = useUpdateLabelGroup(teamKey);
  const deleteLabelGroup = useDeleteLabelGroup(teamKey);
  const retireLabel = useRetireLabel(teamKey);
  const restoreLabel = useRestoreLabel(teamKey);

  // Deleting a group affects its retired labels too, so they count.
  const labelCount = (groupId: string) => allLabels.filter((l) => l.groupId === groupId).length;
  const hasGroups = ownGroups.length > 0;
  const activeLabel = activeId != null ? ownLabels.find((l) => l.id === activeId) : null;
  const ungroupedLabels = ownLabels.filter((l) => l.groupId == null);
  const addingUngrouped = labelForm?.mode === 'add' && labelForm.groupId === null;

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openLabelAdd(groupId: string | null, key: string) {
    setGroupForm(null);
    setLabelForm({ mode: 'add', groupId });
    setLName('');
    // Adding into a group defaults the label to the group's color.
    const groupColor = groupId != null ? ownGroups.find((g) => g.id === groupId)?.color : undefined;
    setLColor(groupColor ?? DEFAULT_COLOR);
    setLGroupId(groupId);
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function openLabelEdit(l: LabelRow) {
    setGroupForm(null);
    setLabelForm({ mode: 'edit', id: l.id });
    setLName(l.name);
    setLColor(l.color);
    setLGroupId(l.groupId);
  }

  function openGroupAdd() {
    setLabelForm(null);
    setGroupForm({ mode: 'add' });
    setGName('');
    setGColor(DEFAULT_COLOR);
  }

  function openGroupEdit(g: LabelGroup) {
    setLabelForm(null);
    setGroupForm({ mode: 'edit', id: g.id });
    setGName(g.name);
    setGColor(g.color);
  }

  async function submitLabel() {
    if (!lName.trim() || !labelForm) return;
    if (labelForm.mode === 'add') {
      await createLabel.mutateAsync({ name: lName.trim(), color: lColor, groupId: lGroupId });
    } else {
      await updateLabel.mutateAsync({
        id: labelForm.id,
        patch: { name: lName.trim(), color: lColor, groupId: lGroupId },
      });
    }
    setLabelForm(null);
  }

  async function submitGroup() {
    if (!gName.trim() || !groupForm) return;
    if (groupForm.mode === 'add') {
      await createLabelGroup.mutateAsync({ name: gName.trim(), color: gColor });
    } else {
      await updateLabelGroup.mutateAsync({
        id: groupForm.id,
        patch: { name: gName.trim(), color: gColor },
      });
    }
    setGroupForm(null);
  }

  // Move the dragged label into the section it was dropped on (its group, or
  // ungrouped). No-op when dropped outside a section or on its current group.
  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (!e.over) return;
    const labelId = String(e.active.id);
    const label = ownLabels.find((l) => l.id === labelId);
    if (!label) return;
    const target = (e.over.data.current as { groupId: string | null } | undefined)?.groupId ?? null;
    if (target === label.groupId) return;
    await updateLabel.mutateAsync({ id: labelId, patch: { groupId: target } });
  }

  const labelFormEl = (
    <SettingsInlineForm
      name={lName}
      onNameChange={setLName}
      placeholder="Label name"
      submitLabel={labelForm?.mode === 'edit' ? 'Save' : 'Add'}
      onSubmit={() => void submitLabel()}
      onCancel={() => setLabelForm(null)}
      leading={<ColorField value={lColor} onChange={setLColor} />}
    />
  );

  // A label as an editing form (when it is the one being edited) or a draggable row.
  function renderLabelRow(l: LabelRow, retired = false) {
    if (labelForm?.mode === 'edit' && labelForm.id === l.id) {
      return (
        <div key={l.id} className="px-3 py-1">
          {labelFormEl}
        </div>
      );
    }
    const count = issueCount?.(l.id) ?? 0;
    return (
      <SettingsDraggableLabelRow
        key={l.id}
        label={l}
        draggable={hasGroups && !retired}
        meta={count === 0 ? undefined : `${count} ${count === 1 ? 'issue' : 'issues'}`}
        onEdit={() => openLabelEdit(l)}
        onDelete={() => setDeletingLabel(l)}
        onRetire={retired ? undefined : () => !retireLabel.isPending && retireLabel.mutate(l.id)}
        onRestore={retired ? () => !restoreLabel.isPending && restoreLabel.mutate(l.id) : undefined}
      />
    );
  }

  const groupFormEl = (
    <SettingsInlineForm
      name={gName}
      onNameChange={setGName}
      placeholder="Group name"
      submitLabel={groupForm?.mode === 'edit' ? 'Save' : 'Add'}
      onSubmit={() => void submitGroup()}
      onCancel={() => setGroupForm(null)}
      leading={<ColorField value={gColor} onChange={setGColor} />}
    />
  );

  return (
    <div className="space-y-3">
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={onDragEnd}
      >
        <div className="divide-y divide-border/50">
          {ownGroups.map((g) => {
            const key = `group:${g.id}`;
            const open = !collapsed.has(key);
            const labels = ownLabels.filter((l) => l.groupId === g.id);
            const groupEditing = groupForm?.mode === 'edit' && groupForm.id === g.id;
            const addingHere = labelForm?.mode === 'add' && labelForm.groupId === g.id;
            return (
              <SettingsLabelGroupSection
                key={key}
                group={g}
                count={labels.length}
                empty={labels.length === 0 && !addingHere}
                dragging={activeId != null}
                open={open}
                editForm={groupEditing ? groupFormEl : undefined}
                onToggle={() => toggle(key)}
                onAddLabel={() => openLabelAdd(g.id, key)}
                onEditGroup={() => openGroupEdit(g)}
                onDeleteGroup={() => setDeletingGroup(g)}
              >
                {labels.map((l) => renderLabelRow(l))}
                {addingHere && <div className="px-3 py-1">{labelFormEl}</div>}
              </SettingsLabelGroupSection>
            );
          })}

          <SettingsLabelGroupSection
            group={null}
            headerless
            count={ungroupedLabels.length}
            empty={ungroupedLabels.length === 0 && !addingUngrouped}
            dragging={activeId != null}
            open
            onToggle={() => {}}
            onAddLabel={() => openLabelAdd(null, 'ungrouped')}
          >
            {ungroupedLabels.map((l) => renderLabelRow(l))}
            {addingUngrouped && <div className="px-3 py-1">{labelFormEl}</div>}
          </SettingsLabelGroupSection>
        </div>

        <DragOverlay>
          {activeLabel ? (
            <div className="flex items-center gap-1.5 rounded-md bg-popover px-2 py-1 text-sm shadow-lg">
              {colorDot(activeLabel.color)}
              {activeLabel.name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {groupForm?.mode === 'add' && <div className="pt-1">{groupFormEl}</div>}

      {can('create') && (
        <SettingsLabelsAddMenu
          disabled={labelForm?.mode === 'add' || groupForm?.mode === 'add'}
          onAddLabel={() => openLabelAdd(null, 'ungrouped')}
          onAddGroup={openGroupAdd}
        />
      )}

      {retiredLabels.length > 0 && (
        <section className="pt-4">
          <h3 className="px-3 pb-1 text-xs font-medium text-muted-foreground">Retired labels</h3>
          <p className="px-3 pb-2 text-xs text-muted-foreground">
            Retired labels stay on their issues but can no longer be added.
          </p>
          <div className="divide-y divide-border/50">
            {retiredLabels.map((l) => renderLabelRow(l, true))}
          </div>
        </section>
      )}

      {deletingLabel && (
        <SettingsLabelDeleteDialog
          label={deletingLabel}
          issueCount={issueCount?.(deletingLabel.id)}
          onClose={() => setDeletingLabel(null)}
          onConfirm={async () => {
            await deleteLabel.mutateAsync(deletingLabel.id);
            setDeletingLabel(null);
          }}
        />
      )}

      {deletingGroup && (
        <SettingsLabelGroupDeleteDialog
          group={deletingGroup}
          labelCount={labelCount(deletingGroup.id)}
          onClose={() => setDeletingGroup(null)}
          onConfirm={async () => {
            await deleteLabelGroup.mutateAsync(deletingGroup.id);
            setDeletingGroup(null);
          }}
        />
      )}
    </div>
  );
}
