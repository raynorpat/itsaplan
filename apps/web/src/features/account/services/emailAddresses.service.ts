'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';

// The signed-in person's extra email addresses (/api/auth/instance/account/emails*).
// They are used only to match people during an issue import; sign-in keeps the
// account's own address. An added address counts once confirmed through the link
// mailed to it.
export interface ExtraEmail {
  id: string;
  email: string;
  verified: boolean;
  createdAt: string;
}

export function useEmailAddressesQuery() {
  return useQuery({
    queryKey: qk.accountEmails,
    queryFn: async () =>
      (await instanceFetch<{ emails: ExtraEmail[] }>('/instance/account/emails')).emails,
  });
}

// Adds an address (or sends a new link for one still pending).
export function useAddEmailAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      instanceFetch('/instance/account/emails/add', { method: 'POST', body: { email } }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.accountEmails }),
  });
}

export function useRemoveEmailAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      instanceFetch('/instance/account/emails/remove', { method: 'POST', body: { id } }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.accountEmails }),
  });
}
