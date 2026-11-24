// The Email addresses section of the profile page: a row's status, and the result the
// confirmation link reports when it lands back on the page (the API redirects with
// `emailConfirmed=1` or `emailConfirmError=<message>`).

export function emailStatusText(entry: { signIn: boolean; verified: boolean }): string {
  if (entry.signIn) return 'Sign-in address';
  return entry.verified ? 'Confirmed' : 'Pending confirmation';
}

export function confirmResult(params: URLSearchParams): { ok: boolean; message: string } | null {
  if (params.get('emailConfirmed') === '1') return { ok: true, message: 'Email address confirmed' };
  const error = params.get('emailConfirmError');
  return error ? { ok: false, message: error } : null;
}
