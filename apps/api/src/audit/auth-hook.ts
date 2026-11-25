import { setAuditHook } from '@repo/auth';
import { currentAuditRequest } from './context';
import { recordAudit, recordLoginFailed } from './store';
import type { AuditType } from './types';

// Gives better-auth's hooks (packages/auth src/audit-hooks.ts) the audit writers, since
// that package cannot import the API. Called once at startup (app.ts).
export function registerAuditHook(): void {
  setAuditHook({
    record: (type, metadata, actorId) => recordAudit(type as AuditType, metadata, { actorId }),
    loginFailed: (address, reason) => recordLoginFailed(address, reason),
    refusalRecorded: () => currentAuditRequest().refusalRecorded === true,
  });
}
