'use client';

import { useState } from 'react';
import SectionPageView from '@/components/common/page/SectionPageView';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import {
  useAuthorizedAppsQuery,
  useRevokeAuthorizedApp,
  type AuthorizedApp,
} from './services/authorizedApps.service';
import AuthorizedAppItem from './components/authorized-apps/AuthorizedAppItem';

// The applications the signed-in person has allowed to act as them
// (/settings/account/authorized-apps), with revoke. Apps installed in the workspace as apps are
// managed by its admins.
export default function AccountAuthorizedAppsPage() {
  const { data: apps, isPending } = useAuthorizedAppsQuery();
  const revoke = useRevokeAuthorizedApp();
  const [revoking, setRevoking] = useState<AuthorizedApp | null>(null);

  return (
    <SectionPageView
      title="Authorized apps"
      description="Applications you have allowed to act as you with OAuth. Revoking one signs it out: its access stops at once."
    >
      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {apps && !apps.length && (
        <p className="text-sm text-muted-foreground">You have not authorized any applications.</p>
      )}
      {apps && apps.length > 0 && (
        <div>
          {apps.map((app) => (
            <AuthorizedAppItem key={app.clientId} app={app} onRevoke={() => setRevoking(app)} />
          ))}
        </div>
      )}
      {revoking && (
        <ConfirmDialog
          title="Revoke access"
          confirmLabel="Revoke"
          onConfirm={async () => {
            await revoke.mutateAsync(revoking.clientId);
            setRevoking(null);
          }}
          onClose={() => setRevoking(null)}
        >
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{revoking.name}</span> will no longer be
            able to act as you.
          </p>
        </ConfirmDialog>
      )}
    </SectionPageView>
  );
}
