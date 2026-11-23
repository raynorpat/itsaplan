import { gqlRequest, graphql } from '@/lib/graphql';
import { uploadToStorage } from '@/services/uploads.service';

// Uploads a file to an issue: the bytes are stored (uploads.service), then
// attachmentCreate records the stored file on the issue. A refusal at any step
// throws ApiError with the API's message, and nothing is recorded.

const AttachUploadMutation = graphql(`
  mutation AttachUpload($input: AttachmentCreateInput!) {
    attachmentCreate(input: $input) {
      attachment {
        id
        title
        url
        metadata
      }
    }
  }
`);

// A stored file attachment: its asset URL serves the bytes without a login, so it
// can be embedded in a description.
export interface UploadedAttachment {
  id: string;
  title: string;
  url: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export async function uploadFile(issueId: string, file: File): Promise<UploadedAttachment> {
  const contentType = file.type || 'application/octet-stream';
  const assetUrl = await uploadToStorage(file, contentType);

  const { attachmentCreate } = await gqlRequest(AttachUploadMutation, {
    input: { issueId, url: assetUrl, title: file.name },
  });
  const a = attachmentCreate.attachment;
  const meta = (a.metadata ?? {}) as { filename?: string; contentType?: string; size?: number };
  return {
    id: a.id,
    title: a.title,
    url: a.url,
    filename: meta.filename ?? file.name,
    contentType: meta.contentType ?? contentType,
    sizeBytes: meta.size ?? file.size,
  };
}
