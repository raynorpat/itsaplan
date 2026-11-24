// The People pages' data: the requesters through the instance plugin
// (/api/auth/instance/requesters*), since Linear's schema has no query or mutation
// for ExternalUser.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import type { StateType } from '@/types/team';
import { isoString } from '../utils/people';

export interface Person {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  feedbackCount: number;
  lastFeedbackAt: string | null;
  // Blocked from the portal (set on a person's page only).
  portalBlocked: boolean;
}

export interface PersonIssueFeedback {
  issue: {
    id: string;
    identifier: string;
    title: string;
    archivedAt: string | null;
    state: { name: string; type: StateType; color: string };
  };
  feedback: {
    id: string;
    body: string | null;
    important: boolean;
    createdAt: string;
    archived: boolean;
  }[];
}

interface PersonDto {
  id: string;
  name: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  feedbackCount: number;
  lastFeedbackAt: unknown;
  portalBlocked?: boolean;
}

interface PersonIssueDto {
  issue: Omit<PersonIssueFeedback['issue'], 'archivedAt'> & { archivedAt: unknown };
  feedback: {
    id: string;
    body: string | null;
    priority: number;
    createdAt: unknown;
    archivedAt?: unknown;
  }[];
}

const toPerson = (r: PersonDto): Person => ({
  id: r.id,
  name: r.name,
  email: r.email,
  avatarUrl: r.avatarUrl,
  feedbackCount: r.feedbackCount,
  lastFeedbackAt: isoString(r.lastFeedbackAt),
  portalBlocked: r.portalBlocked ?? false,
});

const toIssueFeedback = (g: PersonIssueDto): PersonIssueFeedback => ({
  issue: { ...g.issue, archivedAt: isoString(g.issue.archivedAt) },
  feedback: g.feedback.map((f) => ({
    id: f.id,
    body: f.body,
    important: f.priority >= 1,
    createdAt: isoString(f.createdAt) ?? '',
    archived: f.archivedAt != null,
  })),
});

export function usePeopleQuery(q: string, enabled: boolean) {
  const term = q.trim();
  const query = useInfiniteQuery({
    queryKey: qk.requesterList(term),
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (term) params.set('q', term);
      if (pageParam) params.set('cursor', pageParam);
      const res = await instanceFetch<{ requesters: PersonDto[]; nextCursor: string | null }>(
        `/instance/requesters?${params.toString()}`,
      );
      return { people: res.requesters.map(toPerson), nextCursor: res.nextCursor };
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  return {
    ...query,
    people: query.data?.pages.flatMap((p) => p.people) ?? [],
  };
}

export function usePersonQuery(id: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.requester(id),
    enabled,
    queryFn: async () => {
      const res = await instanceFetch<{
        requester: PersonDto & { issues: PersonIssueDto[] };
      }>(`/instance/requester?id=${encodeURIComponent(id)}`);
      return {
        person: toPerson(res.requester),
        issues: res.requester.issues.map(toIssueFeedback),
      };
    },
  });
}

// A requester's name and email show on every feedback item and attachment, so a
// change refreshes the feedback and request counts too.
function useRefreshPeople() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.anyRequesters }),
      qc.invalidateQueries({ queryKey: qk.anyFeedback }),
      qc.invalidateQueries({ queryKey: qk.anyRequests }),
    ]);
}

export function useUpdatePerson() {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: (input: { id: string; name: string; email: string | null }) =>
      instanceFetch<{ requester: PersonDto }>('/instance/requesters/update', {
        method: 'POST',
        body: input,
      }),
    onSuccess: refresh,
  });
}

export function useMergePeople() {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: (input: { fromId: string; intoId: string }) =>
      instanceFetch<{ requester: PersonDto }>('/instance/requesters/merge', {
        method: 'POST',
        body: input,
      }).then((r) => toPerson(r.requester)),
    onSuccess: refresh,
  });
}

// Blocks or unblocks a person from the portal (owners and admins): a blocked person's
// portal sessions end and sign-in links are refused.
export function useSetPortalBlocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { requesterId: string; blocked: boolean }) =>
      instanceFetch('/instance/portal/block', { method: 'POST', body: input }),
    onSuccess: (_d, { requesterId }) =>
      void qc.invalidateQueries({ queryKey: qk.requester(requesterId) }),
  });
}
