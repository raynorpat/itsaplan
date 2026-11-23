// An initiative's updates over GraphQL (Linear's InitiativeUpdate): the list newest
// first with each update's reactions and comments, and posting, editing and
// archiving one (Linear has no delete for initiative updates). Each write refreshes
// the initiative, whose health is its latest update's.

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProjectHealth } from '@/types/project';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { buildThreadsNewestFirst, type FeedEntry } from '@/utils/commentThreads';
import { type ReactionNode } from '@/utils/reactions';
import { invalidateInitiatives } from './initiatives.service';

// Updates per page; each update's comments are read in one page of up to the API's
// maximum.
const PAGE = 20;
const COMMENTS = 250;

const InitiativeUpdatesQuery = graphql(`
  query InitiativeUpdates($id: String!, $first: Int!, $after: String, $comments: Int!) {
    initiative(id: $id) {
      id
      initiativeUpdates(first: $first, after: $after) {
        nodes {
          id
          body
          health
          createdAt
          editedAt
          user {
            id
            name
            avatarUrl
          }
          reactions {
            id
            emoji
            user {
              id
              name
              app
            }
          }
          comments(first: $comments) {
            nodes {
              id
              body
              createdAt
              editedAt
              resolvedAt
              parentId
              user {
                id
                name
                app
              }
              reactions {
                id
                emoji
                user {
                  id
                  name
                  app
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);

export interface InitiativeUpdateItem {
  id: string;
  body: string;
  health: ProjectHealth;
  createdAt: string;
  editedAt: string | null;
  user: { id: string; name: string; image: string | null } | null;
  reactions: ReactionNode[];
  threads: FeedEntry[];
}

// The initiative's updates newest first, a page at a time ("Show older").
export function useInitiativeUpdatesQuery(initiativeId: string, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: qk.initiativeUpdates(initiativeId),
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { initiative } = await gqlRequest(InitiativeUpdatesQuery, {
        id: initiativeId,
        first: PAGE,
        after: pageParam,
        comments: COMMENTS,
      });
      const { nodes, pageInfo } = initiative.initiativeUpdates;
      return {
        items: nodes.map((u): InitiativeUpdateItem => ({
          id: u.id,
          body: u.body,
          health: u.health as ProjectHealth,
          createdAt: u.createdAt,
          editedAt: u.editedAt ?? null,
          user: u.user
            ? { id: u.user.id, name: u.user.name, image: u.user.avatarUrl ?? null }
            : null,
          reactions: u.reactions,
          threads: buildThreadsNewestFirst(u.comments.nodes, u.id),
        })),
        next: pageInfo.hasNextPage ? (pageInfo.endCursor ?? null) : null,
      };
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });
  return {
    data: query.data?.pages.flatMap((p) => p.items),
    isLoading: query.isLoading,
    hasOlder: query.hasNextPage,
    loadingOlder: query.isFetchingNextPage,
    loadOlder: () => void query.fetchNextPage(),
  };
}

export type InitiativeUpdatesResult = ReturnType<typeof useInitiativeUpdatesQuery>;

const UpdateCreate = graphql(`
  mutation InitiativeUpdateCreate($input: InitiativeUpdateCreateInput!) {
    initiativeUpdateCreate(input: $input) {
      success
    }
  }
`);

const UpdateEdit = graphql(`
  mutation InitiativeUpdateUpdate($id: String!, $input: InitiativeUpdateUpdateInput!) {
    initiativeUpdateUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const UpdateArchive = graphql(`
  mutation InitiativeUpdateArchive($id: String!) {
    initiativeUpdateArchive(id: $id) {
      success
    }
  }
`);

function useInitiativeUpdateMutation<V>(initiativeId: string, run: (vars: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.initiativeUpdates(initiativeId) });
      invalidateInitiatives(qc);
    },
  });
}

export const useCreateInitiativeUpdate = (initiativeId: string) =>
  useInitiativeUpdateMutation(initiativeId, (input: { body: string; health: ProjectHealth }) =>
    gqlRequest(UpdateCreate, { input: { initiativeId, ...input } }),
  );

export const useEditInitiativeUpdate = (initiativeId: string) =>
  useInitiativeUpdateMutation(
    initiativeId,
    ({ id, ...input }: { id: string; body: string; health: ProjectHealth }) =>
      gqlRequest(UpdateEdit, { id, input }),
  );

export const useArchiveInitiativeUpdate = (initiativeId: string) =>
  useInitiativeUpdateMutation(initiativeId, (id: string) => gqlRequest(UpdateArchive, { id }));
