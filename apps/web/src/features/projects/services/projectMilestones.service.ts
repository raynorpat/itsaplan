// Creating, editing, reordering and deleting a project's milestones over GraphQL.
// The milestones are read with the project (useProjectQuery), so each write patches
// or refreshes the project.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { type ProjectDetail } from '@/services/projects.service';

const MilestoneCreate = graphql(`
  mutation ProjectMilestoneCreate($input: ProjectMilestoneCreateInput!) {
    projectMilestoneCreate(input: $input) {
      success
    }
  }
`);

const MilestoneUpdate = graphql(`
  mutation ProjectMilestoneUpdate($id: String!, $input: ProjectMilestoneUpdateInput!) {
    projectMilestoneUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const MilestoneDelete = graphql(`
  mutation ProjectMilestoneDelete($id: String!) {
    projectMilestoneDelete(id: $id) {
      success
    }
  }
`);

export interface MilestoneFields {
  name?: string;
  description?: string;
  targetDate?: string | null;
  sortOrder?: number;
}

export function useCreateMilestone(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MilestoneFields & { name: string }) =>
      gqlRequest(MilestoneCreate, { input: { projectId, ...input } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.project(projectId) }),
  });
}

// An edit shows at once (a reorder moves the row before the server answers) and is
// rolled back when it fails.
export function useUpdateMilestone(projectId: string) {
  const qc = useQueryClient();
  const key = qk.project(projectId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MilestoneFields }) =>
      gqlRequest(MilestoneUpdate, { id, input }),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<ProjectDetail>(key);
      qc.setQueryData<ProjectDetail>(key, (p) =>
        p
          ? {
              ...p,
              milestones: p.milestones.map((m) =>
                m.id === id
                  ? {
                      ...m,
                      ...input,
                      description: input.description ?? m.description,
                      name: input.name ?? m.name,
                    }
                  : m,
              ),
            }
          : p,
      );
      return { before };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
    },
    // A milestone's target date is a dependency anchor, so the relations refresh too.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: qk.projectRelations });
    },
  });
}

export function useDeleteMilestone(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => gqlRequest(MilestoneDelete, { id }),
    // Deleting a milestone unsets it on its issues and deletes the dependencies
    // anchored to it.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.project(projectId) });
      void qc.invalidateQueries({ queryKey: qk.projectRelations });
      void qc.invalidateQueries({ queryKey: ['boardIssues'] });
    },
  });
}
