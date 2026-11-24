'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { API_URL, ApiError } from '@/lib/graphql';
import { optimisticVote, type PortalIssue } from '../utils/portal';

// The portal's own API routes (/portal/* on the API origin). They accept only the
// portal session cookie, which the API sets on its own origin, so every request
// sends credentials. Members' sessions and /graphql are never used here.

export interface PortalVisitor {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PortalBoard {
  name: string;
  intro?: string | null;
  access: 'public' | 'restricted';
  comments?: 'portal' | 'all';
  suggestionsEnabled?: boolean;
  showDescription?: boolean;
  canRead: boolean;
  visitor: PortalVisitor | null;
}

export interface PortalIssueDetail extends PortalIssue {
  description: string | null;
}

export interface PortalComment {
  id: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  author: { name: string; avatarUrl: string | null; team: boolean };
  mine: boolean;
}

export type PortalSort = 'top' | 'new';

async function portalFetch<T>(
  path: string,
  init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: Record<string, unknown> },
): Promise<T> {
  const res = await fetch(`${API_URL}/portal${path}`, {
    method: init?.method ?? 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
  return data as T;
}

const board = (slug: string) => `/boards/${encodeURIComponent(slug)}`;
const issuePath = (slug: string, identifier: string) =>
  `${board(slug)}/issues/${encodeURIComponent(identifier)}`;

export const portalKeys = {
  all: ['portal'] as const,
  board: (slug: string) => ['portal', slug] as const,
  issues: (slug: string) => ['portal', slug, 'issues'] as const,
  list: (slug: string, sort: PortalSort, q: string) => ['portal', slug, 'issues', sort, q] as const,
  similar: (slug: string, q: string) => ['portal', slug, 'similar', q] as const,
  issue: (slug: string, identifier: string) => ['portal', slug, 'issue', identifier] as const,
  comments: (slug: string, identifier: string) =>
    ['portal', slug, 'issue', identifier, 'comments'] as const,
  linkInfo: (token: string) => ['portal', 'link', token] as const,
};

export function usePortalBoard(slug: string) {
  return useQuery({
    queryKey: portalKeys.board(slug),
    queryFn: () => portalFetch<PortalBoard>(board(slug)),
    retry: false,
  });
}

export function usePortalIssues(slug: string, sort: PortalSort, q: string, enabled: boolean) {
  return useQuery({
    queryKey: portalKeys.list(slug, sort, q),
    queryFn: async () =>
      (
        await portalFetch<{ issues: PortalIssue[] }>(
          `${board(slug)}/issues?sort=${sort}&q=${encodeURIComponent(q)}`,
        )
      ).issues,
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function usePortalSimilar(slug: string, q: string) {
  return useQuery({
    queryKey: portalKeys.similar(slug, q),
    queryFn: async () =>
      (
        await portalFetch<{ issues: PortalIssue[] }>(
          `${board(slug)}/similar?q=${encodeURIComponent(q)}`,
        )
      ).issues,
    enabled: q.trim().length >= 3,
  });
}

export function usePortalIssue(slug: string, identifier: string) {
  return useQuery({
    queryKey: portalKeys.issue(slug, identifier),
    queryFn: () => portalFetch<PortalIssueDetail>(issuePath(slug, identifier)),
    retry: false,
  });
}

export function usePortalComments(slug: string, identifier: string) {
  return useQuery({
    queryKey: portalKeys.comments(slug, identifier),
    queryFn: async () =>
      (await portalFetch<{ comments: PortalComment[] }>(`${issuePath(slug, identifier)}/comments`))
        .comments,
  });
}

// Applies `change` to every cached copy of the issue: the board's lists and its page.
function patchIssue(
  qc: QueryClient,
  slug: string,
  identifier: string,
  change: (issue: PortalIssue) => PortalIssue,
) {
  qc.setQueriesData<PortalIssue[]>({ queryKey: portalKeys.issues(slug) }, (list) =>
    list?.map((i) => (i.identifier === identifier ? change(i) : i)),
  );
  qc.setQueryData<PortalIssueDetail>(portalKeys.issue(slug, identifier), (detail) =>
    detail ? { ...detail, ...change(detail) } : detail,
  );
}

export function useVote(slug: string, identifier: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (voted: boolean) =>
      portalFetch<{ voted: boolean; votes: number }>(`${issuePath(slug, identifier)}/vote`, {
        method: voted ? 'POST' : 'DELETE',
      }),
    onMutate: (voted) => patchIssue(qc, slug, identifier, (i) => optimisticVote(i, voted)),
    onSuccess: (state) => patchIssue(qc, slug, identifier, (i) => ({ ...i, ...state })),
    onError: () => void qc.invalidateQueries({ queryKey: portalKeys.board(slug) }),
  });
}

export function useCommentMutations(slug: string, identifier: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: portalKeys.comments(slug, identifier) });
    void qc.invalidateQueries({ queryKey: portalKeys.issues(slug) });
  };
  const create = useMutation({
    mutationFn: (input: { body: string; parentId?: string }) =>
      portalFetch(`${issuePath(slug, identifier)}/comments`, { method: 'POST', body: input }),
    onSuccess: refresh,
  });
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      portalFetch(`${board(slug)}/comments/${id}`, { method: 'PATCH', body: { body } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => portalFetch(`${board(slug)}/comments/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  return { create, edit, remove };
}

export function useSuggest(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; details: string }) =>
      portalFetch<{ identifier: string }>(`${board(slug)}/suggestions`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: portalKeys.issues(slug) }),
  });
}

export function useRequestLink() {
  return useMutation({
    mutationFn: (input: { email: string; board: string }) =>
      portalFetch<{ ok: true }>('/auth/link', { method: 'POST', body: input }),
  });
}

export function useLinkInfo(token: string) {
  return useQuery({
    queryKey: portalKeys.linkInfo(token),
    queryFn: () =>
      portalFetch<{ needsName: boolean }>(`/auth/link-info?token=${encodeURIComponent(token)}`),
    retry: false,
    enabled: !!token,
  });
}

// Signing in or out changes what every portal query answers.
export function useConfirmSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { token: string; name?: string }) =>
      portalFetch<{ visitor: PortalVisitor }>('/auth/confirm', { method: 'POST', body: input }),
    onSuccess: () => qc.removeQueries({ queryKey: portalKeys.all }),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => portalFetch<{ ok: true }>('/auth/sign-out', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: portalKeys.all }),
  });
}

export function useUpdateDisplayName(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) =>
      portalFetch<PortalVisitor>('/me', { method: 'POST', body: { displayName } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: portalKeys.board(slug) }),
  });
}
