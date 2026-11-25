// Issue attachments over GraphQL: uploaded files and links, both Linear Attachments
// on the issue. A file is an attachment with sourceType `upload`; its filename,
// content type and size come in `metadata`.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Attachment } from '@/types/issue';
import { gqlRequest, graphql, type ResultOf } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { isFeedbackAttachment } from '@/utils/feedback';
import { uploadFile, type UploadedAttachment } from '../utils/upload';

const IssueAttachmentsQuery = graphql(`
  query IssueAttachments($id: String!) {
    issue(id: $id) {
      id
      attachments(first: 250) {
        nodes {
          id
          title
          subtitle
          url
          sourceType
          metadata
          createdAt
        }
      }
    }
  }
`);

const AttachmentLinkMutation = graphql(`
  mutation AttachmentLink($issueId: String!, $url: String!, $title: String) {
    attachmentLinkURL(issueId: $issueId, url: $url, title: $title) {
      success
    }
  }
`);

const AttachmentUpdateMutation = graphql(`
  mutation AttachmentUpdate($id: String!, $input: AttachmentUpdateInput!) {
    attachmentUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const AttachmentDeleteMutation = graphql(`
  mutation AttachmentDelete($id: String!) {
    attachmentDelete(id: $id) {
      success
    }
  }
`);

// A link on the issue: a pull request, a ticket, any URL.
export interface LinkAttachment {
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
  createdAt: string;
}

export interface IssueAttachments {
  files: Attachment[];
  links: LinkAttachment[];
}

type AttachmentNode = NonNullable<
  ResultOf<typeof IssueAttachmentsQuery>['issue']
>['attachments']['nodes'][number];

function toIssueAttachments(nodes: AttachmentNode[]): IssueAttachments {
  const sorted = [...nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const files: Attachment[] = [];
  const links: LinkAttachment[] = [];
  for (const n of sorted) {
    // A feedback item's source attachment is shown with the feedback.
    if (isFeedbackAttachment(n.sourceType)) continue;
    if (n.sourceType === 'upload') {
      const meta = (n.metadata ?? {}) as {
        filename?: string;
        contentType?: string;
        size?: number;
      };
      files.push({
        id: n.id,
        filename: meta.filename ?? n.title,
        contentType: meta.contentType ?? 'application/octet-stream',
        sizeBytes: meta.size ?? 0,
        createdAt: n.createdAt,
        url: n.url,
      });
    } else {
      links.push({
        id: n.id,
        title: n.title,
        subtitle: n.subtitle ?? null,
        url: n.url,
        createdAt: n.createdAt,
      });
    }
  }
  return { files, links };
}

export function useAttachmentsQuery(issueId: string) {
  return useQuery({
    queryKey: qk.attachments(issueId),
    queryFn: async () => {
      const { issue } = await gqlRequest(IssueAttachmentsQuery, { id: issueId });
      return toIssueAttachments(issue.attachments.nodes);
    },
  });
}

// `inlineErrors`: the caller shows the failure next to the control, so the global
// error toast is not shown as well.
export function useUploadAttachment({ inlineErrors = false }: { inlineErrors?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: inlineErrors },
    mutationFn: ({ issueId, file }: { issueId: string; file: File }): Promise<UploadedAttachment> =>
      uploadFile(issueId, file),
    onSuccess: (_data, { issueId }) => invalidateLinks(qc, issueId),
  });
}

// An issue's attachments changed: its list, and the link count ordering's ranks.
function invalidateLinks(qc: QueryClient, issueId: string): void {
  void qc.invalidateQueries({ queryKey: qk.attachments(issueId) });
  void qc.invalidateQueries({ queryKey: qk.anyIssueOrderRanks });
}

// The form shows its own error, so the global error toast is off.
export function useAddLink(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: ({ url, title }: { url: string; title?: string }) =>
      gqlRequest(AttachmentLinkMutation, { issueId, url, title: title || null }),
    onSuccess: () => invalidateLinks(qc, issueId),
  });
}

export function useRenameAttachment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      gqlRequest(AttachmentUpdateMutation, { id, input: { title } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.attachments(issueId) }),
  });
}

export function useDeleteAttachment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => gqlRequest(AttachmentDeleteMutation, { id }),
    // Deleting a file also strips its embeds from the description, so refetch the
    // issue alongside the list.
    onSuccess: () => {
      invalidateLinks(qc, issueId);
      void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
    },
  });
}
