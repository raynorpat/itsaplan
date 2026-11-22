// Issue relations over GraphQL: the issue's own relations and the ones pointing at
// it, adding one (blocks / blocked by / related / duplicate of) and removing one.
// Marking an issue as a duplicate moves it to a canceled state on the API, so the
// issue, its feed and the board are refetched after a change.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gqlRequest, graphql } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { groupRelations, type RelationGroup, type RelatedIssue } from '@/utils/relations';

const IssueRelationsQuery = graphql(`
  query IssueRelations($id: String!) {
    issue(id: $id) {
      id
      relations(first: 100) {
        nodes {
          id
          type
          issue {
            id
            identifier
            title
          }
          relatedIssue {
            id
            identifier
            title
          }
        }
      }
      inverseRelations(first: 100) {
        nodes {
          id
          type
          issue {
            id
            identifier
            title
          }
          relatedIssue {
            id
            identifier
            title
          }
        }
      }
    }
  }
`);

const RelationCreateMutation = graphql(`
  mutation IssueRelationCreate($input: IssueRelationCreateInput!) {
    issueRelationCreate(input: $input) {
      success
    }
  }
`);

const RelationDeleteMutation = graphql(`
  mutation IssueRelationDelete($id: String!) {
    issueRelationDelete(id: $id) {
      success
    }
  }
`);

const RelationSearchQuery = graphql(`
  query RelationSearch($term: String!) {
    searchIssues(term: $term, first: 10) {
      nodes {
        id
        identifier
        title
      }
    }
  }
`);

export function useIssueRelationsQuery(issueId: string) {
  return useQuery({
    queryKey: qk.issueRelations(issueId),
    queryFn: async (): Promise<RelationGroup[]> => {
      const { issue } = await gqlRequest(IssueRelationsQuery, { id: issueId });
      return groupRelations(issue.relations.nodes, issue.inverseRelations.nodes);
    },
  });
}

// The relation a user picks on the issue page, read from this issue's side.
export type NewRelationKind = 'blocks' | 'blockedBy' | 'related' | 'duplicateOf';

function relationInput(kind: NewRelationKind, issueId: string, otherId: string) {
  switch (kind) {
    case 'blocks':
      return { issueId, relatedIssueId: otherId, type: 'blocks' as const };
    case 'blockedBy':
      return { issueId: otherId, relatedIssueId: issueId, type: 'blocks' as const };
    case 'related':
      return { issueId, relatedIssueId: otherId, type: 'related' as const };
    case 'duplicateOf':
      return { issueId, relatedIssueId: otherId, type: 'duplicate' as const };
  }
}

function useRefreshAfterRelation(issueId: string, teamKey: string | null) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.issueRelations(issueId) });
    void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
    void qc.invalidateQueries({ queryKey: qk.feed(issueId) });
    if (teamKey) void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
  };
}

export function useCreateRelation(issueId: string, teamKey: string | null) {
  const refresh = useRefreshAfterRelation(issueId, teamKey);
  return useMutation({
    mutationFn: ({ kind, otherId }: { kind: NewRelationKind; otherId: string }) =>
      gqlRequest(RelationCreateMutation, { input: relationInput(kind, issueId, otherId) }),
    onSuccess: refresh,
  });
}

export function useDeleteRelation(issueId: string, teamKey: string | null) {
  const refresh = useRefreshAfterRelation(issueId, teamKey);
  return useMutation({
    mutationFn: (relationId: string) => gqlRequest(RelationDeleteMutation, { id: relationId }),
    onSuccess: refresh,
  });
}

export function useRelationSearchQuery(term: string, excludeId: string) {
  return useQuery({
    queryKey: ['relationSearch', term] as const,
    enabled: term.trim().length > 0,
    queryFn: async (): Promise<RelatedIssue[]> => {
      const { searchIssues } = await gqlRequest(RelationSearchQuery, { term: term.trim() });
      return searchIssues.nodes.filter((n) => n.id !== excludeId);
    },
  });
}
