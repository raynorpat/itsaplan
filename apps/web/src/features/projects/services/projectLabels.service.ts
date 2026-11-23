// The workspace's project labels over GraphQL (projectLabels, projectLabelCreate /
// Update / Delete), and whether the viewer may manage them.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { usePermissions } from '@/hooks/usePermissions';
import { canManageProjectLabels } from '../utils/projectLabels';

const ProjectLabelsQuery = graphql(`
  query ProjectLabels($first: Int!, $after: String) {
    projectLabels(first: $first, after: $after) {
      nodes {
        id
        name
        color
        description
        isGroup
        parent {
          id
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

const LabelManagementQuery = graphql(`
  query ProjectLabelManagement {
    organization {
      id
      securitySettings
    }
  }
`);

const ProjectLabelCreate = graphql(`
  mutation ProjectLabelCreate($input: ProjectLabelCreateInput!) {
    projectLabelCreate(input: $input) {
      success
    }
  }
`);

const ProjectLabelUpdate = graphql(`
  mutation ProjectLabelUpdate($id: String!, $input: ProjectLabelUpdateInput!) {
    projectLabelUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const ProjectLabelDelete = graphql(`
  mutation ProjectLabelDelete($id: String!) {
    projectLabelDelete(id: $id) {
      success
    }
  }
`);

// A workspace-level project label; a group holds labels and cannot be applied.
export interface ProjectLabel {
  id: string;
  name: string;
  color: string;
  description: string | null;
  parentId: string | null;
  isGroup: boolean;
}

export function useProjectLabelsQuery() {
  return useQuery({
    queryKey: qk.projectLabels,
    queryFn: async (): Promise<ProjectLabel[]> => {
      const nodes = await fetchAllPages(async (after, first) => {
        const { projectLabels } = await gqlRequest(ProjectLabelsQuery, { first, after });
        return projectLabels;
      });
      return nodes.map(({ parent, ...l }) => ({ ...l, parentId: parent?.id ?? null }));
    },
  });
}

// The organization's labelManagementRole against the viewer's workspace role.
export function useCanManageProjectLabels() {
  const { workspaceRole } = usePermissions();
  const settings = useQuery({
    queryKey: ['projectLabelManagement'],
    queryFn: async () => {
      const { organization } = await gqlRequest(LabelManagementQuery);
      const role = (organization.securitySettings as { labelManagementRole?: unknown })
        .labelManagementRole;
      return typeof role === 'string' ? role : undefined;
    },
  });
  return canManageProjectLabels(workspaceRole, settings.data);
}

// Creates, updates or deletes a project label, then refreshes the label list.
export function useProjectLabelMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: qk.projectLabels });
  return {
    create: useMutation({
      mutationFn: (input: { name: string; color?: string }) =>
        gqlRequest(ProjectLabelCreate, { input }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: { name?: string; color?: string } }) =>
        gqlRequest(ProjectLabelUpdate, { id, input: patch }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => gqlRequest(ProjectLabelDelete, { id }),
      onSuccess: refresh,
    }),
  };
}
