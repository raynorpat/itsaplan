// The email and name someone not signed in to the portal gives with a form's link.
export function contactErrors(email: string, name: string): { email?: string; name?: string } {
  const errors: { email?: string; name?: string } = {};
  const address = email.trim();
  if (!address) errors.email = 'Required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) errors.email = 'Enter an email address';
  if (!name.trim()) errors.name = 'Required';
  return errors;
}
