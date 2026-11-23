import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type BulkIssuePatch,
  type Issue,
  type IssuePatch,
  type NewIssueInput,
} from '@/lib/api';
import { qk } from '@/services/queryKeys';
import { toast } from 'sonner';
import { refetchInFull } from '@/hooks/useChangedSince';
import { patchIssueInList, rollbackRow } from '@/utils/boardCache';
import { runBulk, type BulkResult } from '@/utils/bulk';
import { graphql, gqlRequest, readFragment, type FragmentOf } from '@/lib/graphql';
import { invalidateSubscribedIssueIds } from '@/services/subscribedIssueIds';

// --- The issue over GraphQL (the issue page and every surface reading qk.issue) ---
// The issue's own fields as Linear's Issue, mapped onto the web's Issue type so the
// detail, the context menu and the commands read one shape whichever source a host
// has (the board's rows still come from REST until the board moves to GraphQL).

export const IssueFields = graphql(`
  fragment IssueFields on Issue {
    id
    identifier
    number
    title
    description
    priority
    estimate
    dueDate
    sortOrder
    startedAt
    completedAt
    canceledAt
    createdAt
    updatedAt
    archivedAt
    labelIds
    team {
      id
    }
    state {
      id
    }
    assignee {
      id
    }
    delegate {
      id
    }
    creator {
      id
    }
    parent {
      id
    }
    project {
      id
      name
    }
    projectMilestone {
      id
    }
    cycle {
      id
    }
  }
`);

export function toIssue(data: FragmentOf<typeof IssueFields>): Issue {
  const node = readFragment(IssueFields, data);
  return {
    id: node.id,
    teamId: node.team.id,
    sequenceNumber: node.number,
    identifier: node.identifier,
    project: node.project ? { id: node.project.id, title: node.project.name } : null,
    assigneeUserId: node.assignee?.id ?? null,
    delegateUserId: node.delegate?.id ?? null,
    stateId: node.state.id,
    parentId: node.parent?.id ?? null,
    projectMilestoneId: node.projectMilestone?.id ?? null,
    cycleId: node.cycle?.id ?? null,
    creatorUserId: node.creator?.id ?? null,
    title: node.title,
    description: node.description ?? '',
    priority: node.priority,
    estimate: node.estimate ?? null,
    dueDate: node.dueDate ?? null,
    position: node.sortOrder,
    startedAt: node.startedAt ?? null,
    completedAt: node.completedAt ?? null,
    canceledAt: node.canceledAt ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    archivedAt: node.archivedAt ?? null,
    labelIds: node.labelIds,
  };
}

const IssueQuery = graphql(
  `
    query IssueDetail($id: String!) {
      issue(id: $id) {
        ...IssueFields
      }
    }
  `,
  [IssueFields],
);

const IssueUpdate = graphql(
  `
    mutation IssueDetailUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        issue {
          ...IssueFields
        }
      }
    }
  `,
  [IssueFields],
);

const IssueArchive = graphql(`
  mutation IssueDetailArchive($id: String!) {
    issueArchive(id: $id) {
      success
    }
  }
`);

const IssueUnarchive = graphql(`
  mutation IssueDetailUnarchive($id: String!) {
    issueUnarchive(id: $id) {
      success
    }
  }
`);

const IssueDelete = graphql(`
  mutation IssueDetailDelete($id: String!) {
    issueDelete(id: $id) {
      success
    }
  }
`);

const fetchIssue = async (id: string) => toIssue((await gqlRequest(IssueQuery, { id })).issue);

// The web's IssuePatch as Linear's IssueUpdateInput.
function toUpdateInput(patch: IssuePatch) {
  const input: Record<string, unknown> = {};
  if (patch.stateId !== undefined) input.stateId = patch.stateId;
  if (patch.position !== undefined) input.sortOrder = patch.position;
  if (patch.projectId !== undefined) input.projectId = patch.projectId;
  if (patch.cycleId !== undefined) input.cycleId = patch.cycleId;
  if (patch.assigneeUserId !== undefined) input.assigneeId = patch.assigneeUserId;
  if (patch.delegateUserId !== undefined) input.delegateId = patch.delegateUserId;
  if (patch.title !== undefined) input.title = patch.title;
  if (patch.description !== undefined) input.description = patch.description;
  if (patch.priority !== undefined) input.priority = patch.priority;
  if (patch.dueDate !== undefined) input.dueDate = patch.dueDate;
  if (patch.labelIds !== undefined) input.labelIds = patch.labelIds;
  return input;
}

export function useIssueQuery(id: string | null) {
  return useQuery({
    queryKey: qk.issue(id ?? ''),
    queryFn: () => fetchIssue(id!),
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
      // Linear's issue(id) also takes the identifier ("MKT-42").
      const issue = await fetchIssue(`${teamKey}-${seq}`);
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

// Updating an issue from the board, table, calendar or timeline (a drag or an inline
// field edit) over GraphQL. The board's row is patched before the request resolves,
// replaced by the issue the server returns, and restored on error; the board is not
// reloaded (an edit or a drag is reflected by the returned issue). The issue's own
// caches and its project are reconciled.
export function useUpdateIssue(teamKey: string | null) {
  return useUpdateIssueDetail(teamKey);
}

// Updating an issue from the issue page, the context menu or the commands. The issue
// entry and, when `teamKey` is given, the board's row are patched optimistically, then
// replaced by the returned issue (restored on error).
export function useUpdateIssueDetail(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: IssuePatch }) =>
      toIssue(
        (await gqlRequest(IssueUpdate, { id, input: toUpdateInput(patch) })).issueUpdate.issue!,
      ),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.issue(id) });
      const prevIssue = qc.getQueryData<Issue>(qk.issue(id));
      if (prevIssue) qc.setQueryData<Issue>(qk.issue(id), { ...prevIssue, ...patch } as Issue);
      const boardKey = teamKey ? qk.boardIssues(teamKey) : null;
      let prevRow: Issue | undefined;
      if (boardKey) {
        await qc.cancelQueries({ queryKey: boardKey });
        const board = qc.getQueryData<Issue[]>(boardKey);
        prevRow = board?.find((t) => t.id === id);
        if (board && prevRow)
          qc.setQueryData<Issue[]>(
            boardKey,
            patchIssueInList(board, { ...prevRow, ...patch } as Issue),
          );
      }
      return { prevIssue, prevRow, boardKey };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.prevIssue) qc.setQueryData(qk.issue(id), ctx.prevIssue);
      // Only this edit's row goes back; another edit that succeeded meanwhile stays.
      if (ctx?.boardKey)
        qc.setQueryData<Issue[]>(ctx.boardKey, (list) =>
          list ? rollbackRow(list, ctx.prevRow) : list,
        );
    },
    onSuccess: (issue) => {
      qc.setQueryData(qk.issue(issue.id), issue);
      if (teamKey)
        qc.setQueryData<Issue[]>(qk.boardIssues(teamKey), (list) =>
          list ? patchIssueInList(list, issue) : list,
        );
    },
    onSettled: (_data, _err, { id }) => {
      void qc.invalidateQueries({ queryKey: qk.feed(id) });
      invalidateProjects(qc);
    },
  });
}

// An issue write changes its project's progress and scope, and the projects list
// shows that progress. The mutations do not know the project
// id, so they invalidate by prefix; only active queries refetch.
function invalidateProjects(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: qk.anyProject });
  void qc.invalidateQueries({ queryKey: qk.anyProjects });
}

// Deletes an issue. Drops it from the team detail immediately and discards its
// per-issue caches, then refetches the team to reconcile.
export function useDeleteIssue(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => gqlRequest(IssueDelete, { id }),
    onSuccess: async (_data, id) => {
      if (teamKey) {
        // Cancel any team fetch already in flight before removing the issue
        // from the cache. Such a fetch was issued before the delete (e.g. an
        // earlier edit's onSettled refetch) and still lists the deleted issue;
        // if it resolved after this removal it would re-add the issue until the
        // next refetch. Cancelling discards it so the optimistic removal sticks.
        await qc.cancelQueries({ queryKey: qk.boardIssues(teamKey) });
        qc.setQueryData<Issue[]>(qk.boardIssues(teamKey), (prev) =>
          prev ? prev.filter((t) => t.id !== id) : prev,
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
    mutationFn: (id: string) => gqlRequest(IssueArchive, { id }),
    onSuccess: async (_data, id) => {
      if (teamKey) {
        await qc.cancelQueries({ queryKey: qk.boardIssues(teamKey) });
        qc.setQueryData<Issue[]>(qk.boardIssues(teamKey), (prev) =>
          prev ? prev.filter((t) => t.id !== id) : prev,
        );
        void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
      }
      void qc.invalidateQueries({ queryKey: qk.issue(id) });
      void qc.invalidateQueries({ queryKey: qk.feed(id) });
      invalidateProjects(qc);
    },
  });
}

// Restores an archived issue back onto the board. Invalidates the board (it
// reappears) and the issue's caches.
export function useRestoreIssue(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => gqlRequest(IssueUnarchive, { id }),
    onSuccess: (_data, id) => {
      if (teamKey) {
        void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
      }
      void qc.invalidateQueries({ queryKey: qk.issue(id) });
      void qc.invalidateQueries({ queryKey: qk.feed(id) });
      invalidateProjects(qc);
    },
  });
}

// --- Bulk actions (board multi-select) -------------------------------------------
// Edits run through issueBatchUpdate in groups of 50; archive and delete run per issue.
// The board is patched before the requests resolve; issues the server refused are
// restored and named in a toast, the rest stay applied (see runBulk).

const IssueBatchUpdate = graphql(
  `
    mutation BoardBatchUpdate($ids: [UUID!]!, $input: IssueUpdateInput!) {
      issueBatchUpdate(ids: $ids, input: $input) {
        issues {
          ...IssueFields
        }
      }
    }
  `,
  [IssueFields],
);

const BATCH_SIZE = 50;

// The issues the server refused, by identifier, in one toast.
function reportFailures(action: string, failed: BulkResult['failed'], rows: Issue[] | undefined) {
  if (failed.length === 0) return;
  const name = new Map((rows ?? []).map((r) => [r.id, r.identifier]));
  const list = failed.map((f) => `${name.get(f.id) ?? f.id} (${f.message})`).join(', ');
  toast.error(
    `Could not ${action} ${failed.length} issue${failed.length === 1 ? '' : 's'}: ${list}`,
  );
}

// One batch edit over many issues: the board rows change at once, the server's issues
// replace them, refused ones are restored.
function useBulkEdit<V>(
  teamKey: string,
  toInput: (vars: V) => Record<string, unknown>,
  apply: (issue: Issue, vars: V) => Issue,
) {
  const qc = useQueryClient();
  const key = qk.boardIssues(teamKey);
  return useMutation({
    mutationFn: async (vars: V & { ids: string[] }) => {
      const input = toInput(vars);
      const returned: Issue[] = [];
      const result = await runBulk(vars.ids, {
        size: BATCH_SIZE,
        runChunk: async (ids) => {
          const data = await gqlRequest(IssueBatchUpdate, { ids, input });
          returned.push(...data.issueBatchUpdate.issues.map(toIssue));
        },
        runOne: async (id) => {
          const data = await gqlRequest(IssueUpdate, { id, input });
          returned.push(toIssue(data.issueUpdate.issue!));
        },
      });
      return { result, returned };
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Issue[]>(key);
      if (prev) {
        const idSet = new Set(vars.ids);
        qc.setQueryData<Issue[]>(
          key,
          prev.map((t) => (idSet.has(t.id) ? apply(t, vars) : t)),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: ({ result, returned }, _vars, ctx) => {
      const before = new Map((ctx?.prev ?? []).map((r) => [r.id, r]));
      qc.setQueryData<Issue[]>(key, (list) => {
        if (!list) return list;
        let next = list;
        for (const issue of returned) next = patchIssueInList(next, issue);
        for (const { id } of result.failed) {
          const original = before.get(id);
          if (original) next = patchIssueInList(next, original);
        }
        return next;
      });
      // An open issue page or pane shows the edited issue too.
      for (const issue of returned)
        if (qc.getQueryData(qk.issue(issue.id))) qc.setQueryData(qk.issue(issue.id), issue);
      reportFailures('update', result.failed, ctx?.prev);
    },
    onSettled: () => invalidateProjects(qc),
  });
}

export function useBulkUpdateIssues(teamKey: string) {
  return useBulkEdit<{ patch: BulkIssuePatch }>(
    teamKey,
    ({ patch }) => toUpdateInput(patch),
    (issue, { patch }) => ({ ...issue, ...patch }) as Issue,
  );
}

export function useBulkAddLabels(teamKey: string) {
  return useBulkEdit<{ add: string[] }>(
    teamKey,
    ({ add }) => ({ addedLabelIds: add }),
    (issue, { add }) => ({ ...issue, labelIds: [...new Set([...issue.labelIds, ...add])] }),
  );
}

// Archive and delete drop the issues from the board at once, put back any the server
// refused, then reload the board in full (a changed-since query would not drop them
// elsewhere).
function useBulkRemoval(teamKey: string, action: string, runOne: (id: string) => Promise<unknown>) {
  const qc = useQueryClient();
  const key = qk.boardIssues(teamKey);
  return useMutation({
    mutationFn: (ids: string[]) => runBulk(ids, { size: 1, runOne }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Issue[]>(key);
      const idSet = new Set(ids);
      if (prev)
        qc.setQueryData<Issue[]>(
          key,
          prev.filter((t) => !idSet.has(t.id)),
        );
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: (result, _ids, ctx) => {
      for (const id of result.done) {
        qc.removeQueries({ queryKey: qk.issue(id) });
        qc.removeQueries({ queryKey: qk.feed(id) });
      }
      reportFailures(action, result.failed, ctx?.prev);
    },
    onSettled: () => {
      void refetchInFull(qc, key);
      invalidateProjects(qc);
    },
  });
}

export function useBulkArchiveIssues(teamKey: string) {
  return useBulkRemoval(teamKey, 'archive', (id) => gqlRequest(IssueArchive, { id }));
}

export function useBulkDeleteIssues(teamKey: string) {
  return useBulkRemoval(teamKey, 'delete', (id) => gqlRequest(IssueDelete, { id }));
}

const IssueCreate = graphql(
  `
    mutation BoardIssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        issue {
          ...IssueFields
        }
      }
    }
  `,
  [IssueFields],
);

// The web's NewIssueInput as Linear's IssueCreateInput (teamId takes the team key).
function toCreateInput(teamKey: string, input: NewIssueInput) {
  const out: Record<string, unknown> & { teamId: string } = {
    teamId: teamKey,
    title: input.title,
    stateId: input.stateId,
  };
  if (input.description !== undefined) out.description = input.description;
  if (input.priority !== undefined) out.priority = input.priority;
  if (input.dueDate !== undefined) out.dueDate = input.dueDate;
  if (input.labelIds !== undefined) out.labelIds = input.labelIds;
  if (input.projectId !== undefined) out.projectId = input.projectId;
  if (input.cycleId !== undefined) out.cycleId = input.cycleId;
  if (input.assigneeUserId !== undefined) out.assigneeId = input.assigneeUserId;
  if (input.delegateUserId) out.delegateId = input.delegateUserId;
  return out;
}

// Creates an issue, then reloads the board in full (a new issue is not in the
// changed-since window of every open board).
export function useCreateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ teamKey, input }: { teamKey: string; input: NewIssueInput }) =>
      toIssue(
        (await gqlRequest(IssueCreate, { input: toCreateInput(teamKey, input) })).issueCreate
          .issue!,
      ),
    onSuccess: (_issue, { teamKey }) => {
      void refetchInFull(qc, qk.boardIssues(teamKey));
      void invalidateSubscribedIssueIds(qc);
      invalidateProjects(qc);
    },
  });
}
