'use client';

import { Fragment, type ReactNode } from 'react';
import GodSectionPage from './GodSectionPage';
import OwnerOnly from './OwnerOnly';

// Holds a settings page back until its stored state has loaded, then renders the form
// keyed on that state: a save replaces the cache entry, so the key changes and the
// form remounts with fresh initial values instead of a stale "dirty" comparison.
//
// These pages hold instance secrets (sign-in, email, Google, storage), which only a
// workspace owner may change; an admin sees the form read-only. The API enforces the
// same.
export default function GodSettingsGate<T>({
  slug,
  data,
  children,
}: {
  slug: string;
  data: T | undefined;
  children: (data: T) => ReactNode;
}) {
  if (!data) {
    return (
      <GodSectionPage slug={slug}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </GodSectionPage>
    );
  }
  return (
    <Fragment key={JSON.stringify(data)}>
      <OwnerOnly>{children(data)}</OwnerOnly>
    </Fragment>
  );
}
