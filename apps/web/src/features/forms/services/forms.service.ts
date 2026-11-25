'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { portalFetch } from '@/services/portalFetch.service';
import type { Answers, PublicFormField } from '@/utils/formAnswers';

// A form's link (/forms/<slug>) on the portal's form routes. Someone not signed in to
// the portal gets `pending` and a confirmation email; a signed-in visitor's request is
// created at once.

export interface PublicForm {
  slug: string;
  name: string;
  intro: string;
  fields: PublicFormField[];
  visitor: { id: string; displayName: string; avatarUrl: string | null } | null;
}

// The new issue, and the boards showing it that the person may read.
export interface FormCreated {
  identifier: string;
  boards: { slug: string; name: string }[];
}

export type FormSubmitResult = ({ status: 'created' } & FormCreated) | { status: 'pending' };

const formPath = (slug: string) => `/forms/${encodeURIComponent(slug)}`;

export function usePublicForm(slug: string) {
  return useQuery({
    queryKey: ['forms', slug],
    queryFn: () => portalFetch<PublicForm>(formPath(slug)),
    retry: false,
  });
}

export function useSubmitForm(slug: string) {
  return useMutation({
    mutationFn: (input: { answers: Answers; email?: string; name?: string }) =>
      portalFetch<FormSubmitResult>(formPath(slug), { method: 'POST', body: input }),
  });
}

export function useFormConfirmInfo(token: string) {
  return useQuery({
    queryKey: ['forms', 'confirm', token],
    queryFn: () =>
      portalFetch<{ formName: string }>(`/forms/confirm-info?token=${encodeURIComponent(token)}`),
    retry: false,
    enabled: !!token,
  });
}

export function useConfirmForm() {
  return useMutation({
    mutationFn: (token: string) =>
      portalFetch<FormCreated>('/forms/confirm', { method: 'POST', body: { token } }),
  });
}
