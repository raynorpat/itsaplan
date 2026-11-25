'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { gqlRequest, graphql } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';

// The portal on the issue page (members): the boards showing the issue, through
// /api/auth/instance/portal/issue-boards since Linear's schema has no portal; the
// visitor who suggested it (Linear's Issue.externalUserCreator); and starting a portal
// thread (/api/auth/instance/portal/comment).

export interface IssuePortalBoard {
  id: string;
  slug: string;
  name: string;
  comments: 'portal' | 'all';
}

const IssueSuggesterQuery = graphql(`
  query IssueSuggester($id: String!) {
    issue(id: $id) {
      id
      externalUserCreator {
        id
        name
      }
      attachments {
        nodes {
          sourceType
          subtitle
          externalUserCreator {
            id
          }
        }
      }
    }
  }
`);

export function useIssuePortalBoards(issueId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.issuePortalBoards(issueId),
    queryFn: async () =>
      (
        await instanceFetch<{ boards: IssuePortalBoard[] }>(
          `/instance/portal/issue-boards?issueId=${encodeURIComponent(issueId)}`,
        )
      ).boards,
    enabled,
  });
}

export function useIssueSuggester(issueId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.issuePortalBoards(issueId), 'suggester'],
    queryFn: async () => {
      const { issue } = await gqlRequest(IssueSuggesterQuery, { id: issueId });
      const creator = issue.externalUserCreator;
      if (!creator) return null;
      // The creator's own feedback sources say where the issue came from.
      const subtitles = issue.attachments.nodes.flatMap((a) =>
        a.sourceType === 'feedback' && a.externalUserCreator?.id === creator.id && a.subtitle
          ? [a.subtitle]
          : [],
      );
      return { ...creator, subtitles };
    },
    enabled,
  });
}

// Starts a portal thread on `boardId`; refreshes the issue's comments.
export function usePostOnPortal(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, body }: { boardId: string; body: string }) =>
      instanceFetch<{ id: string }>('/instance/portal/comment', {
        method: 'POST',
        body: { issueId, boardId, body },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.feed(issueId) }),
  });
}
