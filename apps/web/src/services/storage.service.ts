'use client';

import { useQuery } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';

// The instance upload limits, read wherever a file can be picked (issue
// attachments, the markdown editor, the account avatar) so the UI can state the
// limit and reject an oversized file before it is sent. They change rarely, so the
// entry is kept fresh for the session rather than refetched per mount.
export function useStorageSettingsQuery() {
  return useQuery({
    queryKey: qk.storageSettings,
    queryFn: () => instanceFetch<StorageSettings>('/instance/upload-limits'),
    staleTime: 5 * 60_000,
  });
}

// The instance upload limits. Readable by any signed-in user, because the upload UI
// states them before a file is picked. Sizes come from the environment, accepted
// types from the workspace settings.
export interface StorageSettings {
  maxAttachmentMb: number;
  maxAvatarMb: number;
  // Accepted attachment content types: a full type ('application/pdf') or a
  // wildcard ('image/*'). Empty means any type is accepted.
  attachmentMimeTypes: string[];
  // Stored attachment bytes allowed per team, in MB. 0 means unlimited.
  teamQuotaMb: number;
}
