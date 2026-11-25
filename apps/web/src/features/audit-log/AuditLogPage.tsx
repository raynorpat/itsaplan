'use client';

import { useMemo, useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';
import { useWorkspaceUsersQuery } from '@/services/members.service';
import SectionPageView from '@/components/common/page/SectionPageView';
import { useAuditEntries, useAuditEntryTypes } from './services/auditLog.service';
import { NO_FILTERS, type AuditLogFilters } from './utils/auditLog';
import AuditRetentionField from './components/AuditRetentionField';
import AuditLogFilterBar from './components/AuditLogFilterBar';
import AuditLogExportButton from './components/AuditLogExportButton';
import AuditLogTable from './components/AuditLogTable';

// Settings → Workspace → Audit log (/settings/workspace/audit-log): owners and admins
// read who did what, when and from where, filter it, open an entry and export CSV.
// Entries cannot be edited or deleted; owners choose how long they are kept.
export default function AuditLogPage() {
  const { data: session, isPending } = useSession();
  const role = toWorkspaceRole(session?.user.workspaceRole);
  const isAdmin = isWorkspaceAdmin(role);
  const [filters, setFilters] = useState<AuditLogFilters>(NO_FILTERS);
  const entries = useAuditEntries(filters, isAdmin);
  const types = useAuditEntryTypes(isAdmin);
  const users = useWorkspaceUsersQuery(isAdmin);
  const descriptions = useMemo(
    () => new Map((types.data ?? []).map((t) => [t.type, t.description])),
    [types.data],
  );
  const people = useMemo(
    () =>
      (users.data ?? [])
        .map((u) => ({ id: u.userId, name: u.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users.data],
  );

  return (
    <SectionPageView
      wide
      title="Audit log"
      description="Sign-ins, role and access changes, integrations, settings, imports, exports and deletions in this workspace. Entries cannot be changed or deleted."
      actions={isAdmin ? <AuditLogExportButton filters={filters} /> : undefined}
    >
      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isPending && !isAdmin && (
        <p className="text-sm text-muted-foreground">
          Only workspace owners and admins can read the audit log.
        </p>
      )}
      {isAdmin && (
        <div className="grid gap-4">
          <AuditRetentionField isOwner={role === 'owner'} />
          <AuditLogFilterBar
            filters={filters}
            types={types.data ?? []}
            people={people}
            onChange={setFilters}
          />
          {entries.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : entries.isError ? (
            <p className="text-sm text-destructive">The audit log could not be loaded.</p>
          ) : (
            <AuditLogTable
              entries={entries.data ?? []}
              descriptions={descriptions}
              hasMore={entries.hasNextPage}
              loadingMore={entries.isFetchingNextPage}
              onLoadMore={() => void entries.fetchNextPage()}
            />
          )}
        </div>
      )}
    </SectionPageView>
  );
}
