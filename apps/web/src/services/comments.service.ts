// Comment writes over GraphQL for every comment target (an issue, a document, a
// project, a project update): create, edit, delete, resolve and unresolve. Each
// refreshes the target's comment list once it lands.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { invalidateSubscribedIssueIds } from '@/services/subscribedIssueIds';
import { commentTargetInput, commentTargetKey, type CommentTarget } from '@/utils/commentTarget';

const CommentCreate = graphql(`
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
    }
  }
`);

const CommentUpdate = graphql(`
  mutation CommentUpdate($id: String!, $input: CommentUpdateInput!) {
    commentUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const CommentDelete = graphql(`
  mutation CommentDelete($id: String!) {
    commentDelete(id: $id) {
      success
    }
  }
`);

const CommentResolve = graphql(`
  mutation CommentResolve($id: String!) {
    commentResolve(id: $id) {
      success
    }
  }
`);

const CommentUnresolve = graphql(`
  mutation CommentUnresolve($id: String!) {
    commentUnresolve(id: $id) {
      success
    }
  }
`);

// A new comment on an issue or a document, or a reply when parentId is set (the API
// stores a reply to a reply under the thread's root).
export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      target,
      input,
    }: {
      target: CommentTarget;
      input: { body: string; parentId?: string | null };
    }) =>
      gqlRequest(CommentCreate, {
        input: {
          ...commentTargetInput(target),
          body: input.body,
          parentId: input.parentId ?? undefined,
        },
      }),
    onSuccess: (_data, { target }) => {
      void qc.invalidateQueries({ queryKey: commentTargetKey(target) });
      // Commenting on an issue subscribes the author (server side).
      if ('issueId' in target)
        void qc.invalidateQueries({ queryKey: qk.issueSubscribers(target.issueId) });
      void invalidateSubscribedIssueIds(qc);
    },
  });
}

// Edit, delete, resolve and unresolve a comment of an issue or a document. Each
// refreshes the target's comments once it lands.
function useTargetCommentMutation<V extends { target: CommentTarget }>(
  run: (vars: V) => Promise<unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: (_data, _error, { target }) =>
      void qc.invalidateQueries({ queryKey: commentTargetKey(target) }),
  });
}

export function useUpdateComment() {
  return useTargetCommentMutation(
    ({ id, body }: { target: CommentTarget; id: string; body: string }) =>
      gqlRequest(CommentUpdate, { id, input: { body } }),
  );
}

export function useDeleteComment() {
  return useTargetCommentMutation(({ id }: { target: CommentTarget; id: string }) =>
    gqlRequest(CommentDelete, { id }),
  );
}

export function useSetThreadResolved() {
  return useTargetCommentMutation(
    ({ id, resolved }: { target: CommentTarget; id: string; resolved: boolean }) =>
      resolved ? gqlRequest(CommentResolve, { id }) : gqlRequest(CommentUnresolve, { id }),
  );
}
