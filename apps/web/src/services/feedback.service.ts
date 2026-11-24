// Feedback on issues over GraphQL (Linear's CustomerNeed), and the requesters (the
// people who gave it) through the instance plugin, since Linear's schema has no
// operation that creates or finds an ExternalUser.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gqlRequest, graphql, readFragment, type ResultOf } from '@/lib/graphql';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import type { FeedbackItem, FeedbackRequester } from '@/utils/feedback';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { summarizeNeeds } from '@/utils/requests';
import type { IssueFilter } from '@/utils/viewFilters';
import type { RequestSummary } from '@/types/issue';

const FeedbackFields = graphql(`
  fragment FeedbackFields on CustomerNeed {
    id
    body
    priority
    createdAt
    issue {
      id
      identifier
      title
    }
    attachment {
      id
      subtitle
      externalUserCreator {
        id
        name
        displayName
        email
        avatarUrl
      }
    }
  }
`);

const IssueFeedbackQuery = graphql(
  `
    query IssueFeedback($id: String!) {
      issue(id: $id) {
        id
        needs(first: 250) {
          nodes {
            ...FeedbackFields
          }
        }
      }
    }
  `,
  [FeedbackFields],
);

const ProjectFeedbackQuery = graphql(
  `
    query ProjectFeedback($filter: CustomerNeedFilter) {
      customerNeeds(filter: $filter, first: 250) {
        nodes {
          ...FeedbackFields
        }
      }
    }
  `,
  [FeedbackFields],
);

const FeedbackCreate = graphql(`
  mutation FeedbackCreate($input: CustomerNeedCreateInput!) {
    customerNeedCreate(input: $input) {
      success
    }
  }
`);

const FeedbackUpdate = graphql(`
  mutation FeedbackUpdate($id: String!, $input: CustomerNeedUpdateInput!) {
    customerNeedUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const FeedbackDelete = graphql(`
  mutation FeedbackDelete($id: String!) {
    customerNeedDelete(id: $id) {
      success
    }
  }
`);

const OrphanAttachmentDelete = graphql(`
  mutation FeedbackAttachmentDelete($id: String!) {
    attachmentDelete(id: $id) {
      success
    }
  }
`);

type FeedbackNode = ResultOf<typeof FeedbackFields>;

function toFeedbackItem(n: FeedbackNode): FeedbackItem | null {
  // Every feedback item here is on an issue; one without (Linear's unlinked request)
  // is not shown.
  if (!n.issue) return null;
  const creator = n.attachment?.externalUserCreator ?? null;
  return {
    id: n.id,
    body: n.body ?? null,
    important: n.priority >= 1,
    createdAt: n.createdAt,
    issue: { id: n.issue.id, identifier: n.issue.identifier, title: n.issue.title },
    attachmentId: n.attachment?.id ?? null,
    source: n.attachment?.subtitle ?? null,
    requester: creator
      ? {
          id: creator.id,
          name: creator.displayName || creator.name,
          email: creator.email ?? null,
          avatarUrl: creator.avatarUrl ?? null,
        }
      : null,
  };
}

const toItems = (nodes: readonly FeedbackNode[]) =>
  nodes.flatMap((n) => {
    const item = toFeedbackItem(n);
    return item ? [item] : [];
  });

export function useIssueFeedbackQuery(issueId: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: qk.issueFeedback(issueId),
    enabled: opts.enabled,
    queryFn: async () => {
      const { issue } = await gqlRequest(IssueFeedbackQuery, { id: issueId });
      return toItems(readFragment(FeedbackFields, issue.needs.nodes));
    },
  });
}

// The feedback on a project's issues.
export function useProjectFeedbackQuery(projectId: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: qk.projectFeedback(projectId),
    enabled: opts.enabled,
    queryFn: async () => {
      const { customerNeeds } = await gqlRequest(ProjectFeedbackQuery, {
        filter: { issue: { project: { id: { eq: projectId } } } },
      });
      return toItems(readFragment(FeedbackFields, customerNeeds.nodes));
    },
  });
}

// A requester as the instance plugin returns it.
interface RequesterDto {
  id: string;
  name: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  feedbackCount: number;
}

const toRequester = (r: RequesterDto): FeedbackRequester => ({
  id: r.id,
  name: r.displayName || r.name,
  email: r.email,
  avatarUrl: r.avatarUrl,
});

export function useRequesterSearchQuery(q: string, opts: { enabled: boolean }) {
  const term = q.trim();
  return useQuery({
    queryKey: qk.requesterSearch(term),
    enabled: opts.enabled,
    queryFn: async () => {
      const res = await instanceFetch<{ requesters: RequesterDto[] }>(
        `/instance/requesters?q=${encodeURIComponent(term)}`,
      );
      return res.requesters.map(toRequester);
    },
  });
}

export function useCreateRequester() {
  return useMutation({
    mutationFn: async (input: { name: string; email: string | null }) => {
      const res = await instanceFetch<{ requester: RequesterDto }>('/instance/requesters/create', {
        method: 'POST',
        body: { name: input.name, email: input.email },
      });
      return toRequester(res.requester);
    },
  });
}

function useRefreshFeedback() {
  const qc = useQueryClient();
  return (issueIds: readonly string[]) => {
    for (const id of issueIds) {
      void qc.invalidateQueries({ queryKey: qk.issueFeedback(id) });
      void qc.invalidateQueries({ queryKey: qk.attachments(id) });
    }
    void qc.invalidateQueries({ queryKey: qk.anyProjectFeedback });
    void qc.invalidateQueries({ queryKey: qk.anyRequests });
  };
}

// Adds feedback: the requester's source attachment first (the instance plugin, since
// Linear's attachment input cannot name an external person), then Linear's
// customerNeedCreate. When the second step fails the attachment is removed again so
// no orphan source stays on the issue.
export function useAddFeedback(issueId: string) {
  const refresh = useRefreshFeedback();
  return useMutation({
    mutationFn: async (input: { requesterId: string; body: string; important: boolean }) => {
      const { attachmentId } = await instanceFetch<{ attachmentId: string }>(
        '/instance/feedback/attachment',
        { method: 'POST', body: { issueId, requesterId: input.requesterId } },
      );
      try {
        await gqlRequest(FeedbackCreate, {
          input: {
            issueId,
            attachmentId,
            body: input.body.trim() || null,
            priority: input.important ? 1 : 0,
          },
        });
      } catch (err) {
        await gqlRequest(OrphanAttachmentDelete, { id: attachmentId }).catch(() => undefined);
        throw err;
      }
    },
    onSettled: () => refresh([issueId]),
  });
}

export function useUpdateFeedback(issueId: string) {
  const refresh = useRefreshFeedback();
  return useMutation({
    mutationFn: (input: {
      id: string;
      body?: string | null;
      important?: boolean;
      issueId?: string;
    }) =>
      gqlRequest(FeedbackUpdate, {
        id: input.id,
        input: {
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.important !== undefined ? { priority: input.important ? 1 : 0 } : {}),
          ...(input.issueId ? { issueId: input.issueId } : {}),
        },
      }),
    onSettled: (_data, _err, input) =>
      refresh(input.issueId ? [issueId, input.issueId] : [issueId]),
  });
}

// Deletes the feedback and, with it, its source attachment.
export function useDeleteFeedback(issueId: string) {
  const refresh = useRefreshFeedback();
  return useMutation({
    mutationFn: (id: string) => gqlRequest(FeedbackDelete, { id }),
    onSettled: () => refresh([issueId]),
  });
}

const RequestRefsPage = graphql(`
  query RequestRefs($filter: CustomerNeedFilter, $after: String, $first: Int) {
    customerNeeds(filter: $filter, first: $first, after: $after) {
      nodes {
        priority
        issue {
          id
        }
        attachment {
          externalUserCreator {
            id
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

// The feedback summaries of the issues matching `issueFilter` (utils/requests.ts),
// from the feedback items alone: one paged list instead of a field on every issue.
export async function fetchRequestSummaries(
  issueFilter: IssueFilter,
): Promise<Map<string, RequestSummary>> {
  const nodes = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(RequestRefsPage, {
      filter: { issue: issueFilter },
      after,
      first,
    });
    return data.customerNeeds;
  });
  return summarizeNeeds(
    nodes.flatMap((n) =>
      n.issue
        ? [
            {
              issueId: n.issue.id,
              priority: n.priority,
              requesterId: n.attachment?.externalUserCreator?.id ?? null,
            },
          ]
        : [],
    ),
  );
}

// A team's feedback summaries for its board. Off for guests, who read no feedback.
export function useTeamRequests(teamKey: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.teamRequests(teamKey ?? ''),
    queryFn: () => fetchRequestSummaries({ team: { key: { eq: teamKey } } }),
    enabled: enabled && teamKey != null,
  });
}
