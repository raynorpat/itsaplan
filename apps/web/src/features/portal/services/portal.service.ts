'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { portalFetch } from '@/services/portalFetch.service';
import type { Answers, PublicFormField } from '@/utils/formAnswers';
import { optimisticVote, type PortalIssue, type PortalShipped } from '../utils/portal';
import type { SummaryCadence, UpdatePrefs } from '../utils/updates';

// The portal boards' queries and mutations, on the portal's own API routes
// (portalFetch). Members' sessions and /graphql are never used here.

export interface PortalVisitor {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PortalBoard {
  name: string;
  intro?: string | null;
  access: 'public' | 'restricted' | 'customer';
  comments?: 'portal' | 'all';
  suggestionsEnabled?: boolean;
  showDescription?: boolean;
  canRead: boolean;
  visitor: PortalVisitor | null;
}

export interface PortalIssueDetail extends PortalIssue {
  description: string | null;
  // The latest production release the issue shipped in, or null.
  shipped: PortalShipped | null;
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

// A form placed on the board (it replaces the Suggest box).
export interface PortalBoardForm {
  slug: string;
  name: string;
  intro: string;
  fields: PublicFormField[];
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
  forms: (slug: string) => ['portal', slug, 'forms'] as const,
  linkInfo: (token: string) => ['portal', 'link', token] as const,
  updates: ['portal', 'me', 'updates'] as const,
  sinceLastVisit: ['portal', 'me', 'since-last-visit'] as const,
  unsubscribe: (token: string) => ['portal', 'unsubscribe', token] as const,
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

export function usePortalBoardForms(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: portalKeys.forms(slug),
    queryFn: async () =>
      (await portalFetch<{ forms: PortalBoardForm[] }>(`${board(slug)}/forms`)).forms,
    enabled,
  });
}

export function useSubmitBoardForm(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ form, answers }: { form: string; answers: Answers }) =>
      portalFetch<{ identifier: string }>(`${board(slug)}/forms/${encodeURIComponent(form)}`, {
        method: 'POST',
        body: { answers },
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

// The signed-in visitor's email update preferences.
export function usePortalUpdates(enabled: boolean) {
  return useQuery({
    queryKey: portalKeys.updates,
    queryFn: () => portalFetch<UpdatePrefs>('/me/updates'),
    enabled,
  });
}

export type UpdatesPatch = Partial<Pick<UpdatePrefs, 'enabled' | 'changeEmails' | 'summary'>>;

export function useSetPortalUpdates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdatesPatch) =>
      portalFetch<UpdatePrefs>('/me/updates', { method: 'POST', body: patch }),
    onSuccess: (prefs) => qc.setQueryData(portalKeys.updates, prefs),
  });
}

export interface SinceLastVisit {
  paragraph: string | null;
  lines: string[];
}

export function useSinceLastVisit(enabled: boolean) {
  return useQuery({
    queryKey: portalKeys.sinceLastVisit,
    queryFn: () => portalFetch<SinceLastVisit>('/me/since-last-visit'),
    enabled,
    staleTime: Infinity,
  });
}

export function useUnsubscribeInfo(token: string) {
  return useQuery({
    queryKey: portalKeys.unsubscribe(token),
    queryFn: () =>
      portalFetch<{ email: string | null; prefs: UpdatePrefs }>(
        `/unsubscribe?token=${encodeURIComponent(token)}`,
      ),
    retry: false,
    enabled: !!token,
  });
}

// Without `summary`, every update off; with it, only the summary cadence changes.
export function useUnsubscribe(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (summary?: SummaryCadence) =>
      portalFetch<{ prefs: UpdatePrefs }>('/unsubscribe', {
        method: 'POST',
        body: summary ? { token, summary } : { token },
      }),
    onSuccess: ({ prefs }) =>
      qc.setQueryData<{ email: string | null; prefs: UpdatePrefs }>(
        portalKeys.unsubscribe(token),
        (info) => (info ? { ...info, prefs } : info),
      ),
  });
}
