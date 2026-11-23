// Documents on an issue or a project (Linear's issue and project documents) and a
// document's comments, over GraphQL. A document's id is also Linear's
// documentContentId, which its comments are posted to. Deleting moves it to the
// trash, and restoring (documentUnarchive) brings it back.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { graphql, gqlRequest, readFragment } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { buildThreadsNewestFirst, type FeedEntry } from '@/utils/commentThreads';
import { sortDocuments } from '@/utils/documents';
import { documentParentInput, documentsKey, type DocumentParent } from '@/utils/documentParent';

// Connections cap a page at 250.
const PAGE = 250;

const DocumentFields = graphql(`
  fragment DocumentFields on Document {
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
`);

const IssueDocumentsQuery = graphql(
  `
    query IssueDocuments($id: String!, $first: Int!) {
      issue(id: $id) {
        id
        documents(first: $first) {
          nodes {
            ...DocumentFields
          }
        }
      }
    }
  `,
  [DocumentFields],
);

const ProjectDocumentsQuery = graphql(
  `
    query ProjectDocuments($id: String!, $first: Int!) {
      project(id: $id) {
        id
        documents(first: $first) {
          nodes {
            ...DocumentFields
          }
        }
      }
    }
  `,
  [DocumentFields],
);

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
  mutation DocumentCreate($input: DocumentCreateInput!) {
    documentCreate(input: $input) {
      success
      document {
        id
      }
    }
  }
`);

const DocumentUpdate = graphql(`
  mutation DocumentUpdate($id: String!, $input: DocumentUpdateInput!) {
    documentUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const DocumentDelete = graphql(`
  mutation DocumentDelete($id: String!) {
    documentDelete(id: $id) {
      success
    }
  }
`);

const DocumentUnarchive = graphql(`
  mutation DocumentUnarchive($id: String!) {
    documentUnarchive(id: $id) {
      success
    }
  }
`);

export interface DocumentItem {
  id: string;
  title: string;
  content: string | null;
  updatedAt: string;
  creator: { id: string; name: string } | null;
  updatedBy: { id: string; name: string } | null;
}

async function fetchDocuments(parent: DocumentParent): Promise<DocumentItem[]> {
  if ('issueId' in parent) {
    const { issue } = await gqlRequest(IssueDocumentsQuery, { id: parent.issueId, first: PAGE });
    return sortDocuments(readFragment(DocumentFields, issue.documents.nodes));
  }
  const { project } = await gqlRequest(ProjectDocumentsQuery, {
    id: parent.projectId,
    first: PAGE,
  });
  return sortDocuments(readFragment(DocumentFields, project.documents.nodes));
}

// The parent's documents, most recently updated first.
export function useDocumentsQuery(parent: DocumentParent) {
  return useQuery({
    queryKey: documentsKey(parent),
    queryFn: () => fetchDocuments(parent),
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
      return buildThreadsNewestFirst(document.comments.nodes, document.id);
    },
  });
}

// Create, update, trash and restore refresh the parent's document list.
function useDocumentMutation<V, R>(parent: DocumentParent, run: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => void qc.invalidateQueries({ queryKey: documentsKey(parent) }),
  });
}

export function useCreateDocument(parent: DocumentParent) {
  return useDocumentMutation(parent, async (input: { title: string; content?: string }) => {
    const { documentCreate } = await gqlRequest(DocumentCreate, {
      input: { ...documentParentInput(parent), title: input.title, content: input.content },
    });
    return documentCreate.document?.id ?? null;
  });
}

export function useUpdateDocument(parent: DocumentParent) {
  return useDocumentMutation(
    parent,
    ({ id, patch }: { id: string; patch: { title?: string; content?: string } }) =>
      gqlRequest(DocumentUpdate, { id, input: patch }),
  );
}

export function useTrashDocument(parent: DocumentParent) {
  return useDocumentMutation(parent, (id: string) => gqlRequest(DocumentDelete, { id }));
}

export function useRestoreDocument(parent: DocumentParent) {
  return useDocumentMutation(parent, (id: string) => gqlRequest(DocumentUnarchive, { id }));
}
