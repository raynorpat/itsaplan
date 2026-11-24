// The activity line for a parent change. `from` / `to` are the parent identifiers
// ("ENG-3"); null on a side means the issue had no parent there.
export function parentChangeText(from: string | null, to: string | null): string {
  if (from && to) return `changed parent from ${from} to ${to}`;
  if (to) return `set parent to ${to}`;
  return `removed parent ${from ?? 'an issue'}`;
}
