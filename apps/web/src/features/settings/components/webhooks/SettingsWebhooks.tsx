import { useEffect, useState } from 'react';
import type { TeamDetail, Webhook } from '@/lib/api';
import {
  useWebhooksQuery,
  useAllTeamsWebhooksQuery,
  useCreateWebhook,
  useUpdateWebhook,
  useRotateWebhookSecret,
  useDeleteWebhook,
} from '@/services/webhooks.service';
import { usePermissions } from '@/hooks/usePermissions';
import { isWorkspaceAdmin } from '@/utils/workspaceRoles';
import { EmptyState } from '@/components/common/page/EmptyState';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import SettingsConfirmDeleteDialog from '../crud/SettingsConfirmDeleteDialog';
import { SettingsWebhookDialog, type WebhookFormValue } from './SettingsWebhookDialog';
import { SettingsWebhooksTable } from './SettingsWebhooksTable';

// Team settings tab for outgoing webhooks. Each webhook posts the events of its
// resource types to its URL in Linear's format, signed with a per-webhook secret.
// All-teams webhooks are listed after the team's own for users who may manage
// them. Delivery is handled by the server; this tab manages the subscriptions.
export default function SettingsWebhooks({
  team,
  requestNew,
  onNewHandled,
}: {
  team: TeamDetail;
  requestNew: boolean;
  onNewHandled: () => void;
}) {
  const teamKey = team.team.key;
  const webhooksQuery = useWebhooksQuery(teamKey);
  const { workspaceRole } = usePermissions();
  // All-teams webhooks are for workspace admins and owners, as the API rules.
  const canAllTeams = workspaceRole != null && isWorkspaceAdmin(workspaceRole);
  const allTeamsQuery = useAllTeamsWebhooksQuery(canAllTeams);
  const webhooks = [...(webhooksQuery.data ?? []), ...(allTeamsQuery.data ?? [])];
  const createWebhook = useCreateWebhook(team.team.id);
  const updateWebhook = useUpdateWebhook();
  const rotateSecret = useRotateWebhookSecret();
  const deleteWebhook = useDeleteWebhook();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const [rotating, setRotating] = useState<Webhook | null>(null);

  // The "New webhook" button lives in the page header; opening is signalled here.
  useEffect(() => {
    if (!requestNew) return;
    setEditing('new');
    onNewHandled();
  }, [requestNew, onNewHandled]);

  const saving = createWebhook.isPending || updateWebhook.isPending;
  const editingWebhook =
    editing != null && editing !== 'new' ? webhooks.find((w) => w.id === editing) : undefined;
  const showDialog = editing === 'new' || editingWebhook != null;

  async function saveWebhook({ allTeams, ...input }: WebhookFormValue) {
    if (editing === 'new') {
      await createWebhook.mutateAsync({ input, allTeams });
    } else if (editing != null) {
      await updateWebhook.mutateAsync({ id: editing, input });
    }
    setEditing(null);
  }

  return (
    <>
      {webhooks.length === 0 ? (
        <EmptyState
          title="No webhooks yet"
          description="Set a payload URL and choose which resource types to send."
        />
      ) : (
        <div className="space-y-4">
          <SettingsWebhooksTable
            webhooks={webhooks}
            onEdit={setEditing}
            onRotateSecret={setRotating}
            onDelete={setDeleting}
          />
        </div>
      )}

      {showDialog && (
        <SettingsWebhookDialog
          key={editingWebhook?.id ?? 'new'}
          teamKey={teamKey}
          initial={editingWebhook}
          canAllTeams={canAllTeams}
          saving={saving}
          onSave={saveWebhook}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <SettingsConfirmDeleteDialog
          title="Delete webhook"
          confirmLabel="Delete webhook"
          message={
            <>
              Deliveries to <span className="font-medium">{deleting.url}</span> will stop. This
              cannot be undone.
            </>
          }
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteWebhook.mutateAsync(deleting.id);
            setDeleting(null);
          }}
        />
      )}

      {rotating && (
        <ConfirmDialog
          title="Rotate secret"
          confirmLabel="Rotate secret"
          onClose={() => setRotating(null)}
          onConfirm={async () => {
            await rotateSecret.mutateAsync(rotating.id);
            setRotating(null);
          }}
        >
          <div className="text-sm text-muted-foreground">
            A new secret replaces the current one at once. Deliveries to{' '}
            <span className="font-medium">{rotating.url}</span> fail verification until the receiver
            uses the new secret.
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
