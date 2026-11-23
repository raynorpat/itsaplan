// An initiative's links over GraphQL: projects (initiativeToProjectCreate / Delete)
// and sub-initiatives (initiativeRelationCreate / Delete), plus the lists the add
// pickers offer (projects by name search, every relation, the possible owners).

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Assignee } from '@/types/team';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { ownerCandidates } from '../utils/initiativeOwners';
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
  query InitiativeProjectPicker($filter: ProjectFilter, $first: Int!) {
    projects(filter: $filter, first: $first) {
      nodes {
        id
        name
      }
    }
  }
`);

// The first 50 visible projects whose name contains the search, for the "Add
// project" picker; loaded when the picker opens.
export function useProjectPickerQuery(search: string, enabled: boolean) {
  return useQuery({
    queryKey: ['initiativeProjectPicker', search],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { projects } = await gqlRequest(ProjectNamesQuery, {
        filter: search ? { name: { containsIgnoreCase: search } } : null,
        first: 50,
      });
      return projects.nodes;
    },
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

const LeadTeamMembersQuery = graphql(`
  query InitiativeLeadTeamMembers($id: String!, $first: Int!, $after: String) {
    team(id: $id) {
      visibility
      members(first: $first, after: $after) {
        nodes {
          id
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);

// The people who may own the initiative (ownerCandidates), shaped for the shared
// AssigneeSelect.
export function useInitiativeOwnersQuery(leadTeamId: string | null) {
  return useQuery({
    queryKey: ['initiativeOwners', leadTeamId],
    queryFn: async (): Promise<Assignee[]> => {
      const users = await fetchAllPages(async (after, first) => {
        const { users } = await gqlRequest(UsersQuery, { first, after });
        return users;
      });
      let leadTeam: { private: boolean; memberIds: string[] } | null = null;
      if (leadTeamId) {
        let isPrivate = false;
        const members = await fetchAllPages(async (after, first) => {
          const { team } = await gqlRequest(LeadTeamMembersQuery, { id: leadTeamId, first, after });
          isPrivate = team.visibility === 'private';
          return team.members;
        });
        leadTeam = { private: isPrivate, memberIds: members.map((m) => m.id) };
      }
      return ownerCandidates(users, leadTeam).map((u) => ({
        userId: u.id,
        name: u.name,
        email: u.email,
        image: u.avatarUrl ?? null,
      }));
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
