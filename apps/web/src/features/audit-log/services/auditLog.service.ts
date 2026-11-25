'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL, ApiError, graphql, gqlRequest } from '@/lib/graphql';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import { downloadBlob } from '@/utils/download';
import {
  auditEntryFilter,
  auditExportQuery,
  type AuditLogFilters,
  type AuditRetention,
} from '../utils/auditLog';

// The workspace audit log: entries through Linear's `auditEntries` and
// `auditEntryTypes`, the retention through /api/auth/instance/audit-settings, and the
// CSV export from /api/auth/instance/audit/export (owners and admins).

const PAGE = 50;

const AuditEntriesQuery = graphql(`
  query AuditEntries($filter: AuditEntryFilter, $first: Int!, $after: String) {
    auditEntries(filter: $filter, first: $first, after: $after) {
      nodes {
        id
        type
        createdAt
        ip
        countryCode
        metadata
        requestInformation
        actor {
          id
          name
          email
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

const AuditEntryTypesQuery = graphql(`
  query AuditEntryTypes {
    auditEntryTypes {
      type
      description
    }
  }
`);

export interface AuditEntry {
  id: string;
  type: string;
  createdAt: string;
  ip: string | null;
  countryCode: string | null;
  metadata: Record<string, unknown> | null;
  requestInformation: Record<string, unknown> | null;
  actor: { id: string; name: string; email: string } | null;
}

export function useAuditEntries(filters: AuditLogFilters, enabled: boolean) {
  const filter = auditEntryFilter(filters);
  return useInfiniteQuery({
    queryKey: qk.auditEntries(filter ?? null),
    queryFn: async ({ pageParam }) =>
      (await gqlRequest(AuditEntriesQuery, { filter, first: PAGE, after: pageParam })).auditEntries,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pageInfo.hasNextPage ? last.pageInfo.endCursor : null),
    select: (data) => data.pages.flatMap((p) => p.nodes as AuditEntry[]),
    enabled,
  });
}

export function useAuditEntryTypes(enabled: boolean) {
  return useQuery({
    queryKey: qk.auditEntryTypes,
    queryFn: async () => (await gqlRequest(AuditEntryTypesQuery, {})).auditEntryTypes,
    enabled,
    staleTime: Infinity,
  });
}

export function useAuditSettings(enabled: boolean) {
  return useQuery({
    queryKey: qk.auditSettings,
    queryFn: () => instanceFetch<{ retention: AuditRetention }>('/instance/audit-settings'),
    enabled,
  });
}

export function useSaveAuditRetention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (retention: AuditRetention) =>
      instanceFetch<{ retention: AuditRetention }>('/instance/audit-settings/save', {
        method: 'POST',
        body: { retention },
      }),
    onSuccess: (data) => {
      qc.setQueryData(qk.auditSettings, data);
      void qc.invalidateQueries({ queryKey: ['audit', 'entries'] });
    },
  });
}

// Downloads the filtered entries as CSV. The API records the export in the log.
export async function exportAuditLog(filters: AuditLogFilters): Promise<void> {
  const query = auditExportQuery(filters);
  const res = await fetch(`${API_URL}/api/auth/instance/audit/export${query ? `?${query}` : ''}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText);
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'audit-log.csv';
  downloadBlob(name, await res.blob());
}
