import { ApiError } from '@/lib/graphql';
import { gqlRequest, graphql } from '@/lib/graphql';

// Stores a file the Linear way: fileUpload returns a signed, single-use URL and the
// bytes go there in a plain PUT (the URL is the credential, no cookie). Returns the
// asset URL that attachmentCreate or userUpdate then records. A refusal throws
// ApiError with the API's message.

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

async function putError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new ApiError(res.status, body?.error ?? `Upload failed (${res.status})`);
}

export async function uploadToStorage(file: File, contentType: string): Promise<string> {
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
  return signed.assetUrl;
}
