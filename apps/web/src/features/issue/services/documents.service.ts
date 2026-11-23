// An issue's documents and a document's comments, over GraphQL. A document lives on
// the issue (Linear's issue documents); its id is also Linear's documentContentId,
// which its comments are posted to. Deleting moves it to the trash, and restoring
// (documentUnarchive) brings it back.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { buildFeed, type FeedEntry } from '@/utils/feed';
import { sortDocuments } from '@/utils/documents';

// Connections cap a page at 250.
const PAGE = 250;

const IssueDocumentsQuery = graphql(`
  query IssueDocuments($id: String!, $first: Int!) {
    issue(id: $id) {
      id
      documents(first: $first) {
        nodes {
          id
          title
          content
          updatedAt
          creator {
            id
            name
          }
          updatedBy {
            id
            name
          }
        }
      }
    }
  }
`);

const DocumentCommentsQuery = graphql(`
  query DocumentComments($id: String!, $first: Int!) {
    document(id: $id) {
      id
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
`);

const DocumentCreate = graphql(`
  mutation IssueDocumentCreate($input: DocumentCreateInput!) {
    documentCreate(input: $input) {
      success
      document {
        id
      }
    }
  }
`);

const DocumentUpdate = graphql(`
  mutation IssueDocumentUpdate($id: String!, $input: DocumentUpdateInput!) {
    documentUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const DocumentDelete = graphql(`
  mutation IssueDocumentDelete($id: String!) {
    documentDelete(id: $id) {
      success
    }
  }
`);

const DocumentUnarchive = graphql(`
  mutation IssueDocumentUnarchive($id: String!) {
    documentUnarchive(id: $id) {
      success
    }
  }
`);

export interface IssueDocument {
  id: string;
  title: string;
  content: string | null;
  updatedAt: string;
  creator: { id: string; name: string } | null;
  updatedBy: { id: string; name: string } | null;
}

export function useIssueDocumentsQuery(issueId: string) {
  return useQuery({
    queryKey: qk.issueDocuments(issueId),
    queryFn: async (): Promise<IssueDocument[]> => {
      const { issue } = await gqlRequest(IssueDocumentsQuery, { id: issueId, first: PAGE });
      return sortDocuments(issue.documents.nodes);
    },
  });
}

// A document's comment threads, newest first, as the issue feed shows them.
export function useDocumentCommentsQuery(documentId: string) {
  return useQuery({
    queryKey: qk.documentComments(documentId),
    queryFn: async (): Promise<FeedEntry[]> => {
      const { document } = await gqlRequest(DocumentCommentsQuery, {
        id: documentId,
        first: PAGE,
      });
      return buildFeed(document.comments.nodes, [], document.id);
    },
  });
}

// Create, update, trash and restore refresh the issue's document list.
function useIssueDocumentMutation<V, R>(issueId: string, run: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.issueDocuments(issueId) }),
  });
}

export function useCreateIssueDocument(issueId: string) {
  return useIssueDocumentMutation(issueId, async (input: { title: string; content?: string }) => {
    const { documentCreate } = await gqlRequest(DocumentCreate, {
      input: { issueId, title: input.title, content: input.content },
    });
    return documentCreate.document?.id ?? null;
  });
}

export function useUpdateIssueDocument(issueId: string) {
  return useIssueDocumentMutation(
    issueId,
    ({ id, patch }: { id: string; patch: { title?: string; content?: string } }) =>
      gqlRequest(DocumentUpdate, { id, input: patch }),
  );
}

export function useTrashIssueDocument(issueId: string) {
  return useIssueDocumentMutation(issueId, (id: string) => gqlRequest(DocumentDelete, { id }));
}

export function useRestoreIssueDocument(issueId: string) {
  return useIssueDocumentMutation(issueId, (id: string) => gqlRequest(DocumentUnarchive, { id }));
}
