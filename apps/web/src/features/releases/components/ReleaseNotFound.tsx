// What a release page shows while it loads, or when its pipeline or release is not
// found (or not visible to the viewer).
export default function ReleaseNotFound({ loading, what }: { loading: boolean; what: string }) {
  return (
    <p className="px-6 py-8 text-sm text-muted-foreground">
      {loading ? 'Loading…' : `${what} not found.`}
    </p>
  );
}
