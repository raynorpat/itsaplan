import { ApiError } from '@/lib/api';
import { gqlRequest, graphql } from '@/lib/graphql';

// Uploads a file to an issue the Linear way: fileUpload returns a signed, single-use
// URL; the bytes go there in a plain PUT (the URL is the credential, no cookie); then
// attachmentCreate records the stored file on the issue. A refusal at any step
// throws ApiError with the API's message, and nothing is recorded.

const FileUploadMutation = graphql(`
  mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
    fileUpload(contentType: $contentType, filename: $filename, size: $size) {
      uploadFile {
        uploadUrl
        assetUrl
        headers {
          key
          value
        }
      }
    }
  }
`);

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

async function putError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new ApiError(res.status, body?.error ?? `Upload failed (${res.status})`);
}

export async function uploadFile(issueId: string, file: File): Promise<UploadedAttachment> {
  const contentType = file.type || 'application/octet-stream';
  const { fileUpload } = await gqlRequest(FileUploadMutation, {
    contentType,
    filename: file.name,
    size: file.size,
  });
  const signed = fileUpload.uploadFile;
  if (!signed) throw new ApiError(500, 'Upload failed');

  const headers = new Headers();
  for (const h of signed.headers) headers.set(h.key, h.value);
  const res = await fetch(signed.uploadUrl, { method: 'PUT', headers, body: file });
  if (!res.ok) throw await putError(res);

  const { attachmentCreate } = await gqlRequest(AttachUploadMutation, {
    input: { issueId, url: signed.assetUrl, title: file.name },
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
