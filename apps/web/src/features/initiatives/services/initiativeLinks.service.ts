// An initiative's links over GraphQL: projects (initiativeToProjectCreate / Delete)
// and sub-initiatives (initiativeRelationCreate / Delete), plus the lists the add
// pickers offer (every visible project, every relation, the workspace's people).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Assignee } from '@/lib/api';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { invalidateInitiatives } from './initiatives.service';

const RelationsQuery = graphql(`
  query InitiativeRelations($first: Int!, $after: String) {
    initiativeRelations(first: $first, after: $after) {
      nodes {
        id
        initiative {
          id
        }
        relatedInitiative {
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

// Every sub-initiative relation the viewer can see. Linear's initiativeRelations
// takes no filter, so the page picks the initiative's own from this list.
export function useInitiativeRelationsQuery() {
  return useQuery({
    queryKey: qk.initiativeRelations,
    queryFn: async () => {
      const nodes = await fetchAllPages(async (after, first) => {
        const { initiativeRelations } = await gqlRequest(RelationsQuery, { first, after });
        return initiativeRelations;
      });
      return nodes.map((r) => ({
        id: r.id,
        initiativeId: r.initiative.id,
        relatedInitiativeId: r.relatedInitiative.id,
      }));
    },
  });
}

const ProjectNamesQuery = graphql(`
  query InitiativeProjectPicker($first: Int!, $after: String) {
    projects(first: $first, after: $after) {
      nodes {
        id
        name
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

// Every project the viewer can see, for the "Add project" picker; loaded when the
// picker opens.
export function useProjectPickerQuery(enabled: boolean) {
  return useQuery({
    queryKey: [...qk.anyProjects, 'initiativePicker'],
    enabled,
    queryFn: () =>
      fetchAllPages(async (after, first) => {
        const { projects } = await gqlRequest(ProjectNamesQuery, { first, after });
        return projects;
      }),
  });
}

const UsersQuery = graphql(`
  query InitiativeOwners($first: Int!, $after: String) {
    users(first: $first, after: $after) {
      nodes {
        id
        name
        email
        avatarUrl
        guest
        active
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

// The people who may own an initiative: active users who are not guests (the owner
// must be able to see it), shaped for the shared AssigneeSelect.
export function useInitiativeOwnersQuery() {
  return useQuery({
    queryKey: ['initiativeOwners'],
    queryFn: async (): Promise<Assignee[]> => {
      const nodes = await fetchAllPages(async (after, first) => {
        const { users } = await gqlRequest(UsersQuery, { first, after });
        return users;
      });
      return nodes
        .filter((u) => u.active && !u.guest)
        .map((u) => ({ userId: u.id, name: u.name, email: u.email, image: u.avatarUrl ?? null }));
    },
  });
}

const LinkProject = graphql(`
  mutation InitiativeToProjectCreate($input: InitiativeToProjectCreateInput!) {
    initiativeToProjectCreate(input: $input) {
      success
    }
  }
`);

const UnlinkProject = graphql(`
  mutation InitiativeToProjectDelete($id: String!) {
    initiativeToProjectDelete(id: $id) {
      success
    }
  }
`);

const AddSubInitiative = graphql(`
  mutation InitiativeRelationCreate($input: InitiativeRelationCreateInput!) {
    initiativeRelationCreate(input: $input) {
      success
    }
  }
`);

const RemoveSubInitiative = graphql(`
  mutation InitiativeRelationDelete($id: String!) {
    initiativeRelationDelete(id: $id) {
      success
    }
  }
`);

// Each change refreshes the initiatives (their project counts and children). A
// refused change (a hidden project, a loop, the depth limit) shows the API's message
// through the global mutation toast and changes nothing.
function useLinkMutation<V>(run: (vars: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: run, onSuccess: () => invalidateInitiatives(qc) });
}

export const useLinkProject = (initiativeId: string) =>
  useLinkMutation((projectId: string) =>
    gqlRequest(LinkProject, { input: { initiativeId, projectId } }),
  );

export const useUnlinkProject = () =>
  useLinkMutation((linkId: string) => gqlRequest(UnlinkProject, { id: linkId }));

export const useAddSubInitiative = (initiativeId: string) =>
  useLinkMutation((relatedInitiativeId: string) =>
    gqlRequest(AddSubInitiative, { input: { initiativeId, relatedInitiativeId } }),
  );

export const useRemoveSubInitiative = () =>
  useLinkMutation((relationId: string) => gqlRequest(RemoveSubInitiative, { id: relationId }));
