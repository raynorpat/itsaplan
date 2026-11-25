// Project dependencies (Linear's ProjectRelation) over GraphQL. The workspace's
// relations the viewer can see are loaded once (a relation is listed only when both
// projects are visible) and shared by the project page, the projects table and the
// projects timeline.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import type { AnchorType, ProjectRelationItem, RelationEnd } from '@/utils/projectRelations';

const ProjectRelationsQuery = graphql(`
  query ProjectRelations($first: Int, $after: String) {
    projectRelations(first: $first, after: $after) {
      nodes {
        id
        anchorType
        relatedAnchorType
        project {
          id
          name
          startDate
          targetDate
        }
        projectMilestone {
          id
          name
          targetDate
        }
        relatedProject {
          id
          name
          startDate
          targetDate
        }
        relatedProjectMilestone {
          id
          name
          targetDate
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

const ProjectRelationCreate = graphql(`
  mutation ProjectRelationCreate($input: ProjectRelationCreateInput!) {
    projectRelationCreate(input: $input) {
      success
    }
  }
`);

const ProjectRelationDelete = graphql(`
  mutation ProjectRelationDelete($id: String!) {
    projectRelationDelete(id: $id) {
      success
    }
  }
`);

interface ProjectNode {
  id: string;
  name: string;
  startDate?: string | null;
  targetDate?: string | null;
}

interface MilestoneNode {
  id: string;
  name: string;
  targetDate?: string | null;
}

const relationEnd = (
  project: ProjectNode,
  anchorType: string,
  milestone: MilestoneNode | null | undefined,
): RelationEnd => ({
  projectId: project.id,
  projectName: project.name,
  startDate: project.startDate ?? null,
  targetDate: project.targetDate ?? null,
  anchorType: anchorType as AnchorType,
  milestone: milestone
    ? { id: milestone.id, name: milestone.name, targetDate: milestone.targetDate ?? null }
    : null,
});

async function fetchProjectRelations(): Promise<ProjectRelationItem[]> {
  const nodes = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(ProjectRelationsQuery, { after, first });
    return data.projectRelations;
  });
  return nodes.map((n) => ({
    id: n.id,
    from: relationEnd(n.project, n.anchorType, n.projectMilestone),
    to: relationEnd(n.relatedProject, n.relatedAnchorType, n.relatedProjectMilestone),
  }));
}

export function useAllProjectRelations(enabled = true) {
  return useQuery({
    queryKey: qk.projectRelations,
    queryFn: fetchProjectRelations,
    enabled,
  });
}

// One project's dependencies: where it blocks another project and where it is blocked.
export function useProjectRelations(projectId: string) {
  const query = useAllProjectRelations();
  const all = query.data ?? [];
  return {
    ...query,
    blockedBy: all.filter((r) => r.to.projectId === projectId),
    blocking: all.filter((r) => r.from.projectId === projectId),
  };
}

export interface ProjectRelationInput {
  projectId: string;
  anchorType: AnchorType;
  projectMilestoneId?: string | null;
  relatedProjectId: string;
  relatedAnchorType: AnchorType;
  relatedProjectMilestoneId?: string | null;
}

const onError = (err: Error) => toast.error(err.message);

export function useCreateProjectRelation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectRelationInput) =>
      gqlRequest(ProjectRelationCreate, { input: { type: 'dependency', ...input } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.projectRelations }),
    onError,
  });
}

export function useDeleteProjectRelation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => gqlRequest(ProjectRelationDelete, { id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.projectRelations }),
    onError,
  });
}
