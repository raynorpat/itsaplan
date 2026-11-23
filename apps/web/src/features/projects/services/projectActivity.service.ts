// The project's activity on the overview over GraphQL: its history, its comments and
// its updates, read together and merged by buildProjectFeed. Each connection pages
// newest first; the latest PAGE of each is shown.

import { useQuery } from '@tanstack/react-query';
import { type ProjectHealth } from '@/lib/api';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { buildProjectFeed, type ProjectFeedEntry } from '../utils/projectFeed';

const PAGE = 50;

const ProjectActivityQuery = graphql(`
  query ProjectActivity($id: String!, $first: Int!) {
    project(id: $id) {
      id
      history(first: $first) {
        nodes {
          id
          createdAt
          entries
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
      projectUpdates(first: $first) {
        nodes {
          id
          createdAt
          health
          body
          user {
            id
            name
          }
        }
      }
    }
  }
`);

export function useProjectActivityQuery(projectId: string) {
  return useQuery({
    queryKey: qk.projectActivity(projectId),
    queryFn: async (): Promise<ProjectFeedEntry[]> => {
      const { project } = await gqlRequest(ProjectActivityQuery, { id: projectId, first: PAGE });
      return buildProjectFeed(
        project.history.nodes,
        project.comments.nodes,
        project.projectUpdates.nodes.map((u) => ({
          ...u,
          health: u.health as ProjectHealth,
        })),
        project.id,
      );
    },
  });
}
