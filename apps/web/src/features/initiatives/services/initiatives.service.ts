// The workspace's initiatives over GraphQL (Linear's Initiative): the list, one
// initiative with its projects and sub-initiatives, and creating, changing,
// archiving, unarchiving and deleting one.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { type ProjectHealth, type ProjectStatus } from '@/lib/api';
import { type TadaDocumentNode } from 'gql.tada';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { type InitiativeStatus } from '../utils/initiativeMeta';

const InitiativesQuery = graphql(`
  query Initiatives($first: Int!, $after: String) {
    initiatives(first: $first, after: $after) {
      nodes {
        id
        name
        status
        health
        targetDate
        owner {
          id
          name
          avatarUrl
        }
        parentInitiative {
          id
        }
        projects(first: 250) {
          nodes {
            id
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

export interface InitiativeUser {
  id: string;
  name: string;
  image: string | null;
}

// One row of the initiatives list. projectCount counts the projects of its
// sub-initiatives too, as Linear's Initiative.projects does.
export interface InitiativeSummary {
  id: string;
  name: string;
  status: InitiativeStatus;
  health: ProjectHealth | null;
  targetDate: string | null;
  owner: InitiativeUser | null;
  parentId: string | null;
  projectCount: number;
}

const toUser = (u: { id: string; name: string; avatarUrl?: string | null } | null | undefined) =>
  u ? { id: u.id, name: u.name, image: u.avatarUrl ?? null } : null;

// Every unarchived initiative the viewer can see. A workspace has few, so the list
// loads whole and is filtered in the browser.
export function useInitiativesQuery(enabled = true) {
  return useQuery({
    queryKey: qk.initiatives,
    enabled,
    queryFn: async (): Promise<InitiativeSummary[]> => {
      const nodes = await fetchAllPages(async (after, first) => {
        const { initiatives } = await gqlRequest(InitiativesQuery, { first, after });
        return initiatives;
      });
      return nodes.map((i) => ({
        id: i.id,
        name: i.name,
        status: i.status,
        health: i.health ?? null,
        targetDate: i.targetDate ?? null,
        owner: toUser(i.owner),
        parentId: i.parentInitiative?.id ?? null,
        projectCount: i.projects.nodes.length,
      }));
    },
  });
}

const InitiativeQuery = graphql(`
  query Initiative($id: String!) {
    initiative(id: $id) {
      id
      name
      description
      content
      status
      health
      targetDate
      updatedAt
      archivedAt
      owner {
        id
        name
        avatarUrl
      }
      leadTeam {
        id
        key
        name
      }
      parentInitiative {
        id
        name
      }
      projects(first: 250, includeSubInitiatives: false) {
        nodes {
          id
          name
          health
          status {
            type
          }
          initiativeToProjects(first: 250) {
            nodes {
              id
              initiative {
                id
              }
            }
          }
        }
      }
      subInitiatives(first: 250) {
        nodes {
          id
          name
          status
          health
        }
      }
    }
  }
`);

// A project linked to the initiative, with its links to every initiative (the
// remove takes this initiative's link).
export interface LinkedProject {
  id: string;
  name: string;
  health: ProjectHealth | null;
  status: ProjectStatus;
  initiativeToProjects: { id: string; initiativeId: string }[];
}

export interface SubInitiative {
  id: string;
  name: string;
  status: InitiativeStatus;
  health: ProjectHealth | null;
}

export interface InitiativeDetail {
  id: string;
  name: string;
  description: string;
  content: string;
  status: InitiativeStatus;
  health: ProjectHealth | null;
  targetDate: string | null;
  updatedAt: string;
  archivedAt: string | null;
  owner: InitiativeUser | null;
  leadTeam: { id: string; key: string; name: string } | null;
  parent: { id: string; name: string } | null;
  projects: LinkedProject[];
  subInitiatives: SubInitiative[];
}

export function useInitiativeQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: qk.initiative(id),
    enabled,
    queryFn: async (): Promise<InitiativeDetail> => {
      const { initiative: i } = await gqlRequest(InitiativeQuery, { id });
      return {
        id: i.id,
        name: i.name,
        description: i.description ?? '',
        content: i.content ?? '',
        status: i.status,
        health: i.health ?? null,
        targetDate: i.targetDate ?? null,
        updatedAt: i.updatedAt,
        archivedAt: i.archivedAt ?? null,
        owner: toUser(i.owner),
        leadTeam: i.leadTeam ?? null,
        parent: i.parentInitiative ?? null,
        projects: i.projects.nodes.map((p) => ({
          id: p.id,
          name: p.name,
          health: p.health ?? null,
          status: p.status.type as ProjectStatus,
          initiativeToProjects: p.initiativeToProjects.nodes.map((l) => ({
            id: l.id,
            initiativeId: l.initiative?.id ?? '',
          })),
        })),
        subInitiatives: i.subInitiatives.nodes.map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          health: s.health ?? null,
        })),
      };
    },
  });
}

// Refreshes the list, every loaded initiative (a parent shows its children, a child
// its parent) and the sub-initiative relations.
export function invalidateInitiatives(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: qk.initiatives });
  void qc.invalidateQueries({ queryKey: ['initiative'] });
  void qc.invalidateQueries({ queryKey: qk.initiativeRelations });
}

const InitiativeCreate = graphql(`
  mutation InitiativeCreate($input: InitiativeCreateInput!) {
    initiativeCreate(input: $input) {
      success
      initiative {
        id
      }
    }
  }
`);

export function useCreateInitiative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description: string }) => {
      const { initiativeCreate } = await gqlRequest(InitiativeCreate, { input });
      return initiativeCreate.initiative!.id;
    },
    onSuccess: () => invalidateInitiatives(qc),
  });
}

const InitiativeUpdate = graphql(`
  mutation InitiativeUpdate($id: String!, $input: InitiativeUpdateInput!) {
    initiativeUpdate(id: $id, input: $input) {
      success
    }
  }
`);

// The fields the initiative page edits (Linear's InitiativeUpdateInput).
export interface InitiativeChange {
  name?: string;
  description?: string;
  content?: string;
  status?: InitiativeStatus;
  ownerId?: string | null;
  leadTeamId?: string | null;
  targetDate?: string | null;
}

export function useUpdateInitiative(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InitiativeChange) => gqlRequest(InitiativeUpdate, { id, input }),
    onSuccess: () => invalidateInitiatives(qc),
  });
}

const InitiativeArchive = graphql(`
  mutation InitiativeArchive($id: String!) {
    initiativeArchive(id: $id) {
      success
    }
  }
`);

const InitiativeUnarchive = graphql(`
  mutation InitiativeUnarchive($id: String!) {
    initiativeUnarchive(id: $id) {
      success
    }
  }
`);

const InitiativeDelete = graphql(`
  mutation InitiativeDelete($id: String!) {
    initiativeDelete(id: $id) {
      success
    }
  }
`);

// Archive, unarchive, or delete (Linear moves a deleted initiative to the trash).
function useByIdMutation<R>(document: TadaDocumentNode<R, { id: string }>, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => gqlRequest(document, { id }),
    onSuccess: () => invalidateInitiatives(qc),
  });
}

export const useArchiveInitiative = (id: string) => useByIdMutation(InitiativeArchive, id);
export const useUnarchiveInitiative = (id: string) => useByIdMutation(InitiativeUnarchive, id);
export const useDeleteInitiative = (id: string) => useByIdMutation(InitiativeDelete, id);
