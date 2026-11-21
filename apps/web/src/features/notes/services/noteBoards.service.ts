import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type NewNoteBoardInput,
  type NoteBoard,
  type NoteBoardSummary,
  type NoteCanvas,
} from '@/lib/api';
import { qk } from '@/services/queryKeys';

// How many boards the switcher loads per page.
export const NOTE_BOARDS_PAGE = 10;

// Invalidate every switcher/search list (but not open boards' canvases): renaming,
// creating, deleting, or changing a board's visibility all reorder or refilter the
// list. Scoped to the 'search' subtree so it never re-fetches (and clobbers) the
// canvas of a board being edited.
function invalidateSearch(qc: ReturnType<typeof useQueryClient>, teamKey: string) {
  void qc.invalidateQueries({ queryKey: [...qk.noteBoardsForTeam(teamKey), 'search'] });
}

// The board switcher list: name-filtered, paged, most-recently-updated first.
export function useNoteBoardSearch(teamKey: string | null, q: string) {
  return useInfiniteQuery({
    queryKey: qk.noteBoardsSearch(teamKey ?? '', q),
    queryFn: ({ pageParam }) =>
      api.listNoteBoards(teamKey!, {
        q: q || undefined,
        limit: NOTE_BOARDS_PAGE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < NOTE_BOARDS_PAGE ? undefined : allPages.reduce((n, p) => n + p.length, 0),
    enabled: teamKey != null,
  });
}

// One board with its canvas. Always refetched when opened so the canvas reflects
// the latest server state, even after edits on another device.
export function useNoteBoardQuery(teamKey: string | null, boardId: string | null) {
  return useQuery({
    queryKey: qk.noteBoard(teamKey ?? '', boardId ?? ''),
    queryFn: () => api.getNoteBoard(teamKey!, boardId!),
    enabled: teamKey != null && boardId != null,
    refetchOnMount: 'always',
  });
}

export function useCreateNoteBoard(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewNoteBoardInput) => api.createNoteBoard(teamKey!, input),
    onSuccess: () => {
      if (teamKey) invalidateSearch(qc, teamKey);
    },
  });
}

// Renaming changes the tab/switcher list, so invalidate the search lists and write
// the new name into the open board's cache. Canvas autosave uses useSaveNoteCanvas
// instead, which must not refetch mid-edit.
export function useRenameNoteBoard(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, name }: { boardId: string; name: string }) =>
      api.updateNoteBoard(teamKey!, boardId, { name }),
    onSuccess: (updated) => {
      if (!teamKey) return;
      qc.setQueryData<NoteBoard>(qk.noteBoard(teamKey, updated.id), updated);
      invalidateSearch(qc, teamKey);
    },
  });
}

// Toggle a board between public and personal (owned by the caller). Changes both
// the lock icon and which list section it falls under, so refresh the lists.
export function useSetNoteBoardVisibility(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, personal }: { boardId: string; personal: boolean }) =>
      api.updateNoteBoard(teamKey!, boardId, { personal }),
    onSuccess: (updated) => {
      if (!teamKey) return;
      qc.setQueryData<NoteBoard>(qk.noteBoard(teamKey, updated.id), updated);
      invalidateSearch(qc, teamKey);
    },
  });
}

export function useDeleteNoteBoard(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (boardId: string) => api.deleteNoteBoard(teamKey!, boardId),
    onSuccess: (_res, boardId) => {
      if (!teamKey) return;
      qc.removeQueries({ queryKey: qk.noteBoard(teamKey, boardId) });
      invalidateSearch(qc, teamKey);
    },
  });
}

// Persist the canvas without invalidating: the editor holds the live canvas, so a
// refetch would clobber unsaved edits. The saved canvas is written back into the
// board's cache so a later remount reads the current state.
export function useSaveNoteCanvas(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, canvas }: { boardId: string; canvas: NoteCanvas }) =>
      api.updateNoteBoard(teamKey!, boardId, { canvas }),
    onSuccess: (updated) => {
      if (!teamKey) return;
      qc.setQueryData<NoteBoard>(qk.noteBoard(teamKey, updated.id), updated);
    },
  });
}

// Flatten the switcher's paged result into a single board list, so a consumer can
// read the boards without threading useInfiniteQuery's page shape.
export function flattenBoardPages(pages: NoteBoardSummary[][] | undefined): NoteBoardSummary[] {
  return pages?.flat() ?? [];
}
