// A project's updates over GraphQL (Linear's ProjectUpdate): the list newest first
// with each update's reactions and comments, and posting, editing and deleting one.
// Posting sets the project's health, so it patches the project at once and
// refreshes the lists that show health.

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ProjectHealth } from '@/lib/api';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { invalidateProject, type ProjectDetail } from '@/services/projects.service';
import { buildThreadsNewestFirst, type FeedEntry } from '@/utils/commentThreads';
import { type ReactionNode } from '@/utils/reactions';

// Updates per page; each update's comments are read in one page of up to the API's
// maximum.
const PAGE = 20;
const COMMENTS = 250;

const ProjectUpdatesQuery = graphql(`
  query ProjectUpdates($id: String!, $first: Int!, $after: String, $comments: Int!) {
    project(id: $id) {
      id
      projectUpdates(first: $first, after: $after) {
        nodes {
          id
          body
          health
          createdAt
          editedAt
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
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);

export interface ProjectUpdateItem {
  id: string;
  body: string;
  health: ProjectHealth;
  createdAt: string;
  editedAt: string | null;
  user: { id: string; name: string } | null;
  reactions: ReactionNode[];
  threads: FeedEntry[];
}

// The project's updates newest first, a page at a time ("Show older").
export function useProjectUpdatesQuery(projectId: string) {
  const query = useInfiniteQuery({
    queryKey: qk.projectUpdates(projectId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { project } = await gqlRequest(ProjectUpdatesQuery, {
        id: projectId,
        first: PAGE,
        after: pageParam,
        comments: COMMENTS,
      });
      const { nodes, pageInfo } = project.projectUpdates;
      return {
        items: nodes.map((u): ProjectUpdateItem => ({
          id: u.id,
          body: u.body,
          health: u.health as ProjectHealth,
          createdAt: u.createdAt,
          editedAt: u.editedAt ?? null,
          user: u.user,
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

const ProjectUpdateCreate = graphql(`
  mutation ProjectUpdateCreate($input: ProjectUpdateCreateInput!) {
    projectUpdateCreate(input: $input) {
      success
      projectUpdate {
        id
        body
        health
        createdAt
        user {
          id
          name
        }
      }
    }
  }
`);

const ProjectUpdateUpdate = graphql(`
  mutation ProjectUpdateUpdate($id: String!, $input: ProjectUpdateUpdateInput!) {
    projectUpdateUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const ProjectUpdateDelete = graphql(`
  mutation ProjectUpdateDelete($id: String!) {
    projectUpdateDelete(id: $id) {
      success
    }
  }
`);

// Every write refreshes the updates, the activity and the project (its health is its
// latest update's) and the lists showing that health.
function useProjectUpdateMutation<V>(projectId: string, run: (vars: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projectUpdates(projectId) });
      invalidateProject(qc, projectId);
    },
  });
}

export function useCreateProjectUpdate(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; health: ProjectHealth }) =>
      gqlRequest(ProjectUpdateCreate, { input: { projectId, ...input } }),
    onSuccess: ({ projectUpdateCreate: { projectUpdate: u } }) => {
      // The new update is the latest: the project shows its health at once.
      qc.setQueryData<ProjectDetail>(qk.project(projectId), (p) =>
        p && u
          ? {
              ...p,
              health: u.health as ProjectHealth,
              latestUpdate: {
                id: u.id,
                body: u.body,
                health: u.health as ProjectHealth,
                createdAt: u.createdAt,
                user: u.user,
              },
            }
          : p,
      );
      void qc.invalidateQueries({ queryKey: qk.projectUpdates(projectId) });
      invalidateProject(qc, projectId);
    },
  });
}

export function useEditProjectUpdate(projectId: string) {
  return useProjectUpdateMutation(
    projectId,
    ({ id, ...input }: { id: string; body: string; health: ProjectHealth }) =>
      gqlRequest(ProjectUpdateUpdate, { id, input }),
  );
}

export function useDeleteProjectUpdate(projectId: string) {
  return useProjectUpdateMutation(projectId, (id: string) =>
    gqlRequest(ProjectUpdateDelete, { id }),
  );
}
