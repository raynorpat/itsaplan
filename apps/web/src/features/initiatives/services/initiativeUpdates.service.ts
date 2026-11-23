// An initiative's updates over GraphQL (Linear's InitiativeUpdate): the list newest
// first with each update's reactions and comments, and posting, editing and
// archiving one (Linear has no delete for initiative updates). Each write refreshes
// the initiative, whose health is its latest update's.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ProjectHealth } from '@/lib/api';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { buildThreadsNewestFirst, type FeedEntry } from '@/utils/commentThreads';
import { type ReactionNode } from '@/utils/reactions';
import { invalidateInitiatives } from './initiatives.service';

const PAGE = 50;

const InitiativeUpdatesQuery = graphql(`
  query InitiativeUpdates($id: String!, $first: Int!) {
    initiative(id: $id) {
      id
      initiativeUpdates(first: $first) {
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
            }
          }
          comments(first: $first) {
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
              }
              reactions {
                id
                emoji
                user {
                  id
                  name
                }
              }
            }
          }
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

// The latest 50 updates, each with its latest 50 comments.
export function useInitiativeUpdatesQuery(initiativeId: string, enabled = true) {
  return useQuery({
    queryKey: qk.initiativeUpdates(initiativeId),
    enabled,
    queryFn: async (): Promise<InitiativeUpdateItem[]> => {
      const { initiative } = await gqlRequest(InitiativeUpdatesQuery, {
        id: initiativeId,
        first: PAGE,
      });
      return initiative.initiativeUpdates.nodes.map((u) => ({
        id: u.id,
        body: u.body,
        health: u.health as ProjectHealth,
        createdAt: u.createdAt,
        editedAt: u.editedAt ?? null,
        user: u.user ? { id: u.user.id, name: u.user.name, image: u.user.avatarUrl ?? null } : null,
        reactions: u.reactions,
        threads: buildThreadsNewestFirst(u.comments.nodes, u.id),
      }));
    },
  });
}

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
