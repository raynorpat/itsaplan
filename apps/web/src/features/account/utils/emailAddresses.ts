// The Email addresses section of the profile page: a row's status.

export function emailStatusText(entry: { signIn: boolean; verified: boolean }): string {
  if (entry.signIn) return 'Sign-in address';
  return entry.verified ? 'Confirmed' : 'Pending confirmation';
}
