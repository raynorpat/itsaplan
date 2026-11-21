import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type BulkIssuePatch,
  type Issue,
  type IssueFieldValueInput,
  type IssuePatch,
  type NewIssueInput,
  type BoardIssues,
} from '@/lib/api';
import { qk } from '@/services/queryKeys';

export function useIssueQuery(id: string | null) {
  return useQuery({
    queryKey: qk.issue(id ?? ''),
    queryFn: () => api.getIssue(id!),
    enabled: id != null,
  });
}

// Resolves an issue by its team-scoped number (the identifier-based URL). Seeds
// the by-id cache from the result so the detail's useIssueQuery(id) is instant and
// shares one fetch. Enabled only when a number is present.
export function useIssueBySeqQuery(teamKey: string | null, seq: number | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.issueBySeq(teamKey ?? '', seq ?? -1),
    queryFn: async () => {
      const issue = await api.getIssueBySeq(teamKey!, seq!);
      qc.setQueryData(qk.issue(issue.id), issue);
      return issue;
    },
    enabled: teamKey != null && seq != null,
  });
}

// Server-side issue search behind the command palette. Runs only when the palette
// is open and the term is non-empty; includes archived issues (the board payload
// never carries them). keepPreviousData holds the last list while the next query
// runs, so results do not blank out between keystrokes.
export function useIssueSearchQuery(teamKey: string | null, q: string, opts: { enabled: boolean }) {
  const term = q.trim();
  return useQuery({
    queryKey: qk.issueSearch(teamKey ?? '', term),
    queryFn: () => api.searchIssues(teamKey!, { q: term, limit: 50 }),
    enabled: opts.enabled && teamKey != null && term.length > 0,
    placeholderData: keepPreviousData,
  });
}

// Updating an issue (drag/drop move, or an inline field edit). When `teamKey` is
// given the team detail is patched optimistically so the change shows before the
// request resolves, then reconciled on settle. Issue detail, comments and
// activity are invalidated too, since an edit produces new activity events.
export function useUpdateIssue(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: IssuePatch }) => api.updateIssue(id, patch),
    onMutate: async ({ id, patch }) => {
      if (!teamKey) return {};
      const key = qk.boardIssues(teamKey);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardIssues>(key);
      if (prev) {
        qc.setQueryData<BoardIssues>(key, {
          ...prev,
          issues: prev.issues.map((t) => (t.id === id ? ({ ...t, ...patch } as Issue) : t)),
        });
      }
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev && ctx.key) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_data, _err, { id }) => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
      void qc.invalidateQueries({ queryKey: qk.issue(id) });
      void qc.invalidateQueries({ queryKey: qk.feed(id) });
      invalidateProjects(qc);
    },
  });
}

// An issue write changes its project's progress/health and activity, and the
// projects list shows that progress. The mutations do not know the project
// id, so they invalidate by prefix; only active queries refetch.
function invalidateProjects(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: qk.anyProject });
  void qc.invalidateQueries({ queryKey: qk.anyProjectFeed });
  void qc.invalidateQueries({ queryKey: qk.anyProjects });
}

// Deletes an issue. Drops it from the team detail immediately and discards its
// per-issue caches, then refetches the team to reconcile.
export function useDeleteIssue(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteIssue(id),
    onSuccess: async (_data, id) => {
      if (teamKey) {
        // Cancel any team fetch already in flight before removing the issue
        // from the cache. Such a fetch was issued before the delete (e.g. an
        // earlier edit's onSettled refetch) and still lists the deleted issue;
        // if it resolved after this removal it would re-add the issue until the
        // next refetch. Cancelling discards it so the optimistic removal sticks.
        await qc.cancelQueries({ queryKey: qk.boardIssues(teamKey) });
        qc.setQueryData<BoardIssues>(qk.boardIssues(teamKey), (prev) =>
          prev ? { ...prev, issues: prev.issues.filter((t) => t.id !== id) } : prev,
        );
        void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
      }
      qc.removeQueries({ queryKey: qk.issue(id) });
      qc.removeQueries({ queryKey: qk.feed(id) });
      qc.removeQueries({ queryKey: qk.attachments(id) });
      invalidateProjects(qc);
    },
  });
}

// Archives an issue. Like delete, it leaves the board immediately (dropped from the
// team detail), but the row is kept: the archived-issues list and the issue's own
// caches are invalidated so a reopened detail shows the archived state.
export function useArchiveIssue(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.archiveIssue(id),
    onSuccess: async (_data, id) => {
      if (teamKey) {
        await qc.cancelQueries({ queryKey: qk.boardIssues(teamKey) });
        qc.setQueryData<BoardIssues>(qk.boardIssues(teamKey), (prev) =>
          prev ? { ...prev, issues: prev.issues.filter((t) => t.id !== id) } : prev,
        );
        void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
        void qc.invalidateQueries({ queryKey: qk.archivedIssues(teamKey) });
      }
      void qc.invalidateQueries({ queryKey: qk.issue(id) });
      void qc.invalidateQueries({ queryKey: qk.feed(id) });
      invalidateProjects(qc);
    },
  });
}

// Restores an archived issue back onto the board. Invalidates the board (it
// reappears), the archived list (it leaves), and the issue's caches.
export function useRestoreIssue(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.restoreIssue(id),
    onSuccess: (_data, id) => {
      if (teamKey) {
        void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
        void qc.invalidateQueries({ queryKey: qk.archivedIssues(teamKey) });
      }
      void qc.invalidateQueries({ queryKey: qk.issue(id) });
      void qc.invalidateQueries({ queryKey: qk.feed(id) });
      invalidateProjects(qc);
    },
  });
}

// Setting a custom field value. Invalidates the issue (the value lives on it),
// its activity feed, and — since the team's issues carry field values for
// filtering — the team detail.
export function useSetFieldValue(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      issueId,
      fieldId,
      value,
    }: {
      issueId: string;
      fieldId: string;
      value: IssueFieldValueInput;
    }) => api.setFieldValue(issueId, fieldId, value),
    onSettled: (_data, _err, { issueId }) => {
      void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
      void qc.invalidateQueries({ queryKey: qk.feed(issueId) });
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
    },
  });
}

// --- Bulk actions (board multi-select) -------------------------------------------
// One request changes many issues. Each optimistically patches the team cache
// the same way its single-issue counterpart does, then invalidates the board and
// projects on settle. The team detail is patched by id set so the board
// reflects the change before the request resolves.

export function useBulkUpdateIssues(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: BulkIssuePatch }) =>
      api.bulkUpdateIssues(teamKey, ids, patch),
    onMutate: async ({ ids, patch }) => {
      const key = qk.boardIssues(teamKey);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardIssues>(key);
      if (prev) {
        const idSet = new Set(ids);
        qc.setQueryData<BoardIssues>(key, {
          ...prev,
          issues: prev.issues.map((t) => (idSet.has(t.id) ? ({ ...t, ...patch } as Issue) : t)),
        });
      }
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev && ctx.key) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
      invalidateProjects(qc);
    },
  });
}

export function useBulkAddLabels(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, add }: { ids: string[]; add: string[] }) =>
      api.bulkAddLabels(teamKey, ids, add),
    onMutate: async ({ ids, add }) => {
      const key = qk.boardIssues(teamKey);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardIssues>(key);
      if (prev) {
        const idSet = new Set(ids);
        qc.setQueryData<BoardIssues>(key, {
          ...prev,
          issues: prev.issues.map((t) =>
            idSet.has(t.id) ? { ...t, labelIds: [...new Set([...t.labelIds, ...add])] } : t,
          ),
        });
      }
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev && ctx.key) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
      invalidateProjects(qc);
    },
  });
}

// Archive and delete both drop the issues from the board immediately, then
// reconcile. A team fetch already in flight is cancelled first so it cannot
// re-add the removed issues (see the single-issue delete for the same reasoning).
function useBulkRemoval(teamKey: string, run: (ids: string[]) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => run(ids),
    onSuccess: async (_data, ids) => {
      const idSet = new Set(ids);
      await qc.cancelQueries({ queryKey: qk.boardIssues(teamKey) });
      qc.setQueryData<BoardIssues>(qk.boardIssues(teamKey), (prev) =>
        prev ? { ...prev, issues: prev.issues.filter((t) => !idSet.has(t.id)) } : prev,
      );
      void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
      void qc.invalidateQueries({ queryKey: qk.archivedIssues(teamKey) });
      for (const id of ids) {
        qc.removeQueries({ queryKey: qk.issue(id) });
        qc.removeQueries({ queryKey: qk.feed(id) });
      }
      invalidateProjects(qc);
    },
  });
}

export function useBulkArchiveIssues(teamKey: string) {
  return useBulkRemoval(teamKey, (ids) => api.bulkArchiveIssues(teamKey, ids));
}

export function useBulkDeleteIssues(teamKey: string) {
  return useBulkRemoval(teamKey, (ids) => api.bulkDeleteIssues(teamKey, ids));
}

export function useCreateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamKey, input }: { teamKey: string; input: NewIssueInput }) =>
      api.createIssue(teamKey, input),
    onSuccess: (_data, { teamKey }) => {
      void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
      invalidateProjects(qc);
    },
  });
}
