'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useSession } from '@/lib/auth-client';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';
import SectionPageView from '@/components/common/page/SectionPageView';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  useArchiveOAuthApp,
  useOAuthAppsQuery,
  useRotateOAuthAppSecret,
  useRotateOAuthAppWebhookSecret,
  useUninstallOAuthApp,
  type OAuthApp,
  type OAuthAppSecrets,
} from './services/oauthApps.service';
import OAuthAppDialog from './components/oauth-apps/OAuthAppDialog';
import OAuthAppRow, { type OAuthAppAction } from './components/oauth-apps/OAuthAppRow';
import OAuthAppSecretsDialog from './components/oauth-apps/OAuthAppSecretsDialog';

type Confirm = { action: 'rotate-secret' | 'uninstall' | 'archive'; app: OAuthApp };
type Shown = { title: string; clientId?: string; secrets: OAuthAppSecrets };

const CONFIRM_COPY: Record<Confirm['action'], { title: string; label: string; text: string }> = {
  'rotate-secret': {
    title: 'Rotate client secret',
    label: 'Rotate',
    text: 'The current secret stops working at once. Tokens people authorized stay valid; tokens the application got with client credentials are revoked.',
  },
  uninstall: {
    title: 'Uninstall application',
    label: 'Uninstall',
    text: 'Every token of the application stops working and its app user is suspended. Its past comments and changes stay.',
  },
  archive: {
    title: 'Archive application',
    label: 'Archive',
    text: 'The application is uninstalled, its tokens stop working and it can no longer be authorized. This cannot be undone.',
  },
};

// The workspace's OAuth applications (/settings/workspace/applications), Linear's Settings →
// API → OAuth applications. Owners and admins register applications, install them as
// apps through the consent page, and rotate, uninstall or archive them.
export default function WorkspaceOAuthAppsPage() {
  const { data: session, isPending } = useSession();
  const isAdmin = isWorkspaceAdmin(toWorkspaceRole(session?.user.workspaceRole));
  const { data: apps } = useOAuthAppsQuery(isAdmin);
  const [editing, setEditing] = useState<OAuthApp | 'new' | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const rotateSecret = useRotateOAuthAppSecret();
  const rotateWebhookSecret = useRotateOAuthAppWebhookSecret();
  const uninstall = useUninstallOAuthApp();
  const archive = useArchiveOAuthApp();

  async function act(app: OAuthApp, action: OAuthAppAction) {
    if (action === 'edit') setEditing(app);
    else if (action === 'rotate-webhook-secret') {
      const { webhookSecret } = await rotateWebhookSecret.mutateAsync(app.clientId);
      setShown({ title: 'Webhook secret rotated', secrets: { webhookSecret } });
    } else setConfirm({ action, app });
  }

  async function confirmAction({ action, app }: Confirm) {
    if (action === 'rotate-secret') {
      const { clientSecret } = await rotateSecret.mutateAsync(app.clientId);
      setShown({ title: 'Client secret rotated', secrets: { clientSecret } });
    } else if (action === 'uninstall') await uninstall.mutateAsync(app.clientId);
    else await archive.mutateAsync(app.clientId);
    setConfirm(null);
  }

  const active = (apps ?? []).filter((a) => !a.archived);
  const archived = (apps ?? []).filter((a) => a.archived);

  return (
    <SectionPageView
      title="OAuth applications"
      description="Applications that sign people in with OAuth, or that are installed in the workspace as apps. Installing happens on the consent page, when an admin authorizes the application with actor=app."
      actions={
        isAdmin && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus />
            New application
          </Button>
        )
      }
    >
      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isPending && !isAdmin && (
        <p className="text-sm text-muted-foreground">
          Only workspace owners and admins can manage OAuth applications.
        </p>
      )}
      {isAdmin && apps && !apps.length && (
        <p className="text-sm text-muted-foreground">No applications yet.</p>
      )}
      {isAdmin && active.length > 0 && (
        <div>
          {active.map((app) => (
            <OAuthAppRow key={app.clientId} app={app} onAction={(a) => act(app, a)} />
          ))}
        </div>
      )}
      {isAdmin && archived.length > 0 && (
        <div className="mt-8 space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Archived</p>
          {archived.map((app) => (
            <OAuthAppRow key={app.clientId} app={app} onAction={() => {}} />
          ))}
        </div>
      )}

      {editing && (
        <OAuthAppDialog
          app={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSecrets={(clientId, secrets) => {
            setEditing(null);
            setShown({
              title: editing === 'new' ? 'Application created' : 'Webhook added',
              clientId: editing === 'new' ? clientId : undefined,
              secrets,
            });
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={CONFIRM_COPY[confirm.action].title}
          confirmLabel={CONFIRM_COPY[confirm.action].label}
          onConfirm={() => confirmAction(confirm)}
          onClose={() => setConfirm(null)}
        >
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{confirm.app.name}</span>:{' '}
            {CONFIRM_COPY[confirm.action].text}
          </p>
        </ConfirmDialog>
      )}
      {shown && (
        <OAuthAppSecretsDialog
          title={shown.title}
          clientId={shown.clientId}
          secrets={shown.secrets}
          onClose={() => setShown(null)}
        />
      )}
    </SectionPageView>
  );
}
