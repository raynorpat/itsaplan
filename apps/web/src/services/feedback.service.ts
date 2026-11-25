// Feedback on issues over GraphQL (Linear's CustomerNeed), and the requesters (the
// people who gave it) through the instance plugin, since Linear's schema has no
// operation that creates or finds an ExternalUser.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gqlRequest, graphql, readFragment, type ResultOf } from '@/lib/graphql';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import { isUnsubscribedRefusal, type FeedbackItem, type FeedbackRequester } from '@/utils/feedback';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { summarizeNeeds } from '@/utils/requests';
import { addFeedbackWithSource } from '@/services/feedbackCreate';
import type { IssueFilter } from '@/utils/viewFilters';
import type { RequestSummary } from '@/types/issue';

const FeedbackFields = graphql(`
  fragment FeedbackFields on CustomerNeed {
    id
    body
    priority
    createdAt
    customer {
      id
      name
    }
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
    query IssueFeedback($id: String!, $first: Int, $after: String) {
      issue(id: $id) {
        id
        needs(first: $first, after: $after) {
          nodes {
            ...FeedbackFields
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `,
  [FeedbackFields],
);

const ProjectFeedbackQuery = graphql(
  `
    query ProjectFeedback($filter: CustomerNeedFilter, $first: Int, $after: String) {
      customerNeeds(filter: $filter, first: $first, after: $after) {
        nodes {
          ...FeedbackFields
        }
        pageInfo {
          hasNextPage
          endCursor
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

const FeedbackExists = graphql(`
  query FeedbackExists($id: String!) {
    customerNeed(id: $id) {
      id
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
    customer: n.customer ? { id: n.customer.id, name: n.customer.name } : null,
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
      const nodes = await fetchAllPages(
        async (after, first) =>
          (await gqlRequest(IssueFeedbackQuery, { id: issueId, after, first })).issue.needs,
      );
      return toItems(readFragment(FeedbackFields, nodes));
    },
  });
}

// The number of people asking on an issue, for a guest, who reads no feedback through
// GraphQL (/api/auth/instance/feedback/count).
export function useIssueFeedbackCountQuery(issueId: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: qk.issueFeedbackCount(issueId),
    enabled: opts.enabled,
    queryFn: async () => {
      const res = await instanceFetch<{ people: number }>(
        `/instance/feedback/count?issueId=${encodeURIComponent(issueId)}`,
      );
      return res.people;
    },
  });
}

// The feedback on a project's issues.
export function useProjectFeedbackQuery(projectId: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: qk.projectFeedback(projectId),
    enabled: opts.enabled,
    queryFn: async () => {
      const nodes = await fetchAllPages(
        async (after, first) =>
          (
            await gqlRequest(ProjectFeedbackQuery, {
              filter: { issue: { project: { id: { eq: projectId } } } },
              after,
              first,
            })
          ).customerNeeds,
      );
      return toItems(readFragment(FeedbackFields, nodes));
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
  customer?: { id: string; name: string } | null;
}

const toRequester = (r: RequesterDto): FeedbackRequester => ({
  id: r.id,
  name: r.displayName || r.name,
  email: r.email,
  avatarUrl: r.avatarUrl,
  customer: r.customer ? { id: r.customer.id, name: r.customer.name } : null,
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

// Creates the person; with `keepUpdated` (and an email) also turns on their email
// updates ("Keep this person updated"). An email that already belongs to someone who
// unsubscribed returns that person with updates left off (the API answers 409), and
// `updatesRefused` says so.
export function useCreateRequester() {
  return useMutation({
    mutationFn: async (input: { name: string; email: string | null; keepUpdated?: boolean }) => {
      const res = await instanceFetch<{ requester: RequesterDto }>('/instance/requesters/create', {
        method: 'POST',
        body: { name: input.name, email: input.email },
      });
      let updatesRefused = false;
      if (input.keepUpdated && input.email) {
        await instanceFetch('/instance/requesters/updates', {
          method: 'POST',
          body: { requesterId: res.requester.id, enabled: true },
        }).catch((error: unknown) => {
          if (!isUnsubscribedRefusal(error)) throw error;
          updatesRefused = true;
        });
      }
      return { requester: toRequester(res.requester), updatesRefused };
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

// Adds feedback: the requester's source attachment, then Linear's customerNeedCreate
// with an id chosen here (services/feedbackCreate.ts handles a failed second step).
export function useAddFeedback(issueId: string) {
  const refresh = useRefreshFeedback();
  return useMutation({
    mutationFn: (input: { requesterId: string; body: string; important: boolean }) =>
      addFeedbackWithSource({
        createAttachment: async () =>
          (
            await instanceFetch<{ attachmentId: string }>('/instance/feedback/attachment', {
              method: 'POST',
              body: { issueId, requesterId: input.requesterId },
            })
          ).attachmentId,
        createNeed: (id, attachmentId) =>
          gqlRequest(FeedbackCreate, {
            input: {
              id,
              issueId,
              attachmentId,
              body: input.body.trim() || null,
              priority: input.important ? 1 : 0,
            },
          }),
        needExists: async (id) =>
          (await gqlRequest(FeedbackExists, { id }).catch(() => null))?.customerNeed != null,
        deleteAttachment: (attachmentId) =>
          gqlRequest(OrphanAttachmentDelete, { id: attachmentId }),
      }),
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
  query RequestRefs(
    $filter: CustomerNeedFilter
    $after: String
    $first: Int
    $includeArchived: Boolean
  ) {
    customerNeeds(
      filter: $filter
      first: $first
      after: $after
      includeArchived: $includeArchived
    ) {
      nodes {
        id
        priority
        issue {
          id
        }
        attachment {
          externalUserCreator {
            id
          }
        }
        customer {
          id
          revenue
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
// Without `includeArchived` the API leaves out feedback on archived issues (the board
// shows none); Insights asks for them, since its period includes archived issues.
// The list grows with the team's active feedback: 250 items per request.
export async function fetchRequestSummaries(
  issueFilter: IssueFilter,
  opts: { includeArchived?: boolean } = {},
): Promise<Map<string, RequestSummary>> {
  const nodes = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(RequestRefsPage, {
      filter: { issue: issueFilter },
      after,
      first,
      includeArchived: opts.includeArchived ?? false,
    });
    return data.customerNeeds;
  });
  return summarizeNeeds(
    nodes.flatMap((n) =>
      n.issue
        ? [
            {
              id: n.id,
              issueId: n.issue.id,
              priority: n.priority,
              requesterId: n.attachment?.externalUserCreator?.id ?? null,
              customerId: n.customer?.id ?? null,
              customerRevenue: n.customer?.revenue ?? null,
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
