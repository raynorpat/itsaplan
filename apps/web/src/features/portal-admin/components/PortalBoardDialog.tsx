'use client';

import { useState } from 'react';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { useDeleteBoard, useSaveBoard, type BoardDto } from '../services/portalAdmin.service';
import {
  boardFormErrors,
  boardToForm,
  emptyBoardForm,
  formToInput,
  type BoardForm,
} from '../utils/board';
import PortalBoardGeneralFields from './PortalBoardGeneralFields';
import PortalBoardSourceFields from './PortalBoardSourceFields';
import PortalBoardAccessFields from './PortalBoardAccessFields';
import PortalBoardSuggestionFields from './PortalBoardSuggestionFields';

// Creates (`board` null) or edits a board. Problems show once Save was pressed; the
// API's own refusals (a taken address) reach the global error toast.
export default function PortalBoardDialog({
  board,
  onClose,
}: {
  board: BoardDto | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<BoardForm>(board ? boardToForm(board) : emptyBoardForm());
  const [tried, setTried] = useState(false);
  const save = useSaveBoard();
  const remove = useDeleteBoard();
  const errors = tried ? boardFormErrors(form) : {};
  const set = (patch: Partial<BoardForm>) => setForm((f) => ({ ...f, ...patch }));

  function submit() {
    setTried(true);
    if (Object.keys(boardFormErrors(form)).length > 0) return;
    save.mutate({ id: board?.id ?? null, input: formToInput(form) }, { onSuccess: onClose });
  }

  function deleteBoard() {
    if (!board || !window.confirm(`Delete the board "${board.name}"? Its link stops working.`))
      return;
    remove.mutate(board.id, { onSuccess: onClose });
  }

  return (
    <Modal title={board ? 'Edit board' : 'New board'} onClose={onClose} wide>
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <PortalBoardGeneralFields form={form} errors={errors} set={set} />
        <PortalBoardSourceFields form={form} errors={errors} set={set} />
        <PortalBoardAccessFields form={form} errors={errors} set={set} />
        <PortalBoardSuggestionFields form={form} errors={errors} set={set} />
        <div className="flex items-center justify-between gap-2">
          <div>
            {board && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                onClick={deleteBoard}
              >
                Delete board
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {board ? 'Save' : 'Create board'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
