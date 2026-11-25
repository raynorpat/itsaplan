'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import { fetchProjectsPage } from '@/services/projects.service';

// Portal boards through the instance plugin (/api/auth/instance/portal/boards*),
// owners and admins only; Linear's schema has no portal.

export interface BoardInput {
  name: string;
  slug: string;
  intro: string;
  // `customerRequests`: the active issues the board's customer asked for (Customer
  // access only, no team or project).
  shows: 'issues' | 'customerRequests';
  teamId: string | null;
  projectId: string | null;
  labelIds: string[];
  access: 'public' | 'restricted' | 'customer';
  customerId: string | null;
  allowedDomains: string[];
  allowedEmails: string[];
  showDescription: boolean;
  comments: 'portal' | 'all';
  suggestionsEnabled: boolean;
  suggestionTeamId: string | null;
  suggestionStateId: string | null;
  suggestionLabelId: string | null;
  enabled: boolean;
}

export interface BoardDto extends BoardInput {
  id: string;
  // Null for a Customer-access board whose customer was deleted: no one reads it.
  customer: { id: string; name: string } | null;
  issueCount: number;
}

export function usePortalBoardsQuery(enabled: boolean) {
  return useQuery({
    queryKey: qk.portalBoards,
    queryFn: async () =>
      (await instanceFetch<{ boards: BoardDto[] }>('/instance/portal/boards')).boards,
    enabled,
  });
}

// Create (no id) or update a board; refreshes the list and the issue pages' boards.
export function useSaveBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: BoardInput }) =>
      instanceFetch<{ board: BoardDto }>(
        id ? '/instance/portal/boards/update' : '/instance/portal/boards/create',
        { method: 'POST', body: id ? { id, ...input } : { ...input } },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['portal'] }),
  });
}

export function useDeleteBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      instanceFetch('/instance/portal/boards/delete', { method: 'POST', body: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['portal'] }),
  });
}

// Every project the admin can see, for the board's source picker.
export function usePortalProjectOptions() {
  return useQuery({
    queryKey: ['portal', 'projects'],
    queryFn: async () => (await fetchProjectsPage({}, 250)).items,
  });
}
