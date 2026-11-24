import type { Label as LabelRow, LabelGroup } from '@/types/team';
import SettingsConfirmDeleteDialog from '../crud/SettingsConfirmDeleteDialog';

function deleteLabelMessage(issueCount: number | undefined): string {
  if (issueCount === undefined) return 'It will be removed from every issue that has it.';
  if (issueCount === 0) return 'No issues use this label.';
  return `This label is on ${issueCount} issue${issueCount === 1 ? '' : 's'} and will be removed from ${issueCount === 1 ? 'it' : 'them'}.`;
}

export function SettingsLabelDeleteDialog({
  label,
  issueCount,
  onClose,
  onConfirm,
}: {
  label: LabelRow;
  // Unknown for a workspace label (no team's issues are loaded on its page).
  issueCount: number | undefined;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <SettingsConfirmDeleteDialog
      title={`Delete label "${label.name}"`}
      confirmLabel="Delete label"
      message={<>{deleteLabelMessage(issueCount)} This cannot be undone.</>}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

export function SettingsLabelGroupDeleteDialog({
  group,
  labelCount,
  onClose,
  onConfirm,
}: {
  group: LabelGroup;
  labelCount: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <SettingsConfirmDeleteDialog
      title={`Delete group "${group.name}"`}
      confirmLabel="Delete group"
      message={
        <>
          {labelCount > 0
            ? `${labelCount} label${labelCount === 1 ? '' : 's'} will be ungrouped but kept.`
            : 'This group has no labels.'}{' '}
          This cannot be undone.
        </>
      }
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
