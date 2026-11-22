import { t } from 'elysia';
import { getOrganization } from '../organization/store';

// Upload limits. The sizes and the team quota are server limits from the environment
// (MAX_ATTACHMENT_MB, MAX_AVATAR_MB, TEAM_QUOTA_MB); the accepted attachment types are
// the workspace setting `allowedFileUploadContentTypes` (../organization/store.ts).
// They apply to every upload path in the api and are read by the web app before a
// file is picked, so the limit is visible in the UI instead of only surfacing as a 413.

export const MB = 1024 * 1024;

export interface StorageSettings {
  // Upper bound on a single attachment. The multipart body is buffered in memory,
  // so this also bounds per-upload memory.
  maxAttachmentMb: number;
  // Upper bound on a single avatar image.
  maxAvatarMb: number;
  // Accepted attachment content types. An entry is a full type ('application/pdf')
  // or a wildcard ('image/*'). An empty list accepts any type.
  attachmentMimeTypes: string[];
  // Total stored attachment bytes allowed per team, in MB. 0 means unlimited.
  teamQuotaMb: number;
}

// Served by GET /settings/storage (any signed-in user).
export const StorageSettingsSchema = t.Object({
  maxAttachmentMb: t.Number(),
  maxAvatarMb: t.Number(),
  attachmentMimeTypes: t.Array(t.String()),
  teamQuotaMb: t.Number(),
});

// A non-negative number from the environment, or the default when unset or invalid.
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Read per call, so a test or a reload sees changes.
export async function getStorageSettings(): Promise<StorageSettings> {
  const org = await getOrganization();
  return {
    maxAttachmentMb: envNumber('MAX_ATTACHMENT_MB', 25),
    maxAvatarMb: envNumber('MAX_AVATAR_MB', 5),
    attachmentMimeTypes: org.allowedFileUploadContentTypes,
    teamQuotaMb: envNumber('TEAM_QUOTA_MB', 50 * 1024),
  };
}

// Whether a content type passes the allowlist. An empty list accepts anything.
// Entries are already normalized by updateOrganization.
export function mimeAllowed(contentType: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const ct = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return allowed.some((pattern) =>
    pattern.endsWith('/*') ? ct.startsWith(pattern.slice(0, -1)) : ct === pattern,
  );
}
