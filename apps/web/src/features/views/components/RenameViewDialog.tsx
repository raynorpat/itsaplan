import { useState } from 'react';
import type { View } from '@/types/team';
import { useUpdateView } from '@/services/views.service';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Renames a saved view. A failed save is toasted globally; the dialog stays open.
export default function RenameViewDialog({ view, onClose }: { view: View; onClose: () => void }) {
  const [name, setName] = useState(view.name);
  const update = useUpdateView(view.teamKey);
  const trimmed = name.trim();

  function save() {
    if (!trimmed || trimmed === view.name) return onClose();
    update.mutate({ id: view.id, input: { name: trimmed } }, { onSuccess: onClose });
  }

  return (
    <Modal title="Rename view" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trimmed || update.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
