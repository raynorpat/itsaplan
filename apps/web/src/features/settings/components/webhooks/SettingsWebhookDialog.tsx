import { useState } from 'react';
import type { Webhook, WebhookResourceType } from '@/types/workspace';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { SettingsWebhookResourceTypes } from './SettingsWebhookResourceTypes';

export interface WebhookFormValue {
  url: string;
  label: string | null;
  resourceTypes: WebhookResourceType[];
  enabled: boolean;
  allTeams: boolean;
}

// Add/edit dialog for a webhook: the payload URL, an optional label, the resource
// types it receives, and whether it is enabled. `canAllTeams` shows the "All
// teams" switch on a new webhook (a webhook's scope is fixed once created). The
// secret is generated server-side and shown on the row, not here.
export function SettingsWebhookDialog({
  teamKey,
  initial,
  canAllTeams,
  saving,
  onSave,
  onClose,
}: {
  teamKey: string;
  initial?: Webhook;
  canAllTeams: boolean;
  saving: boolean;
  onSave: (value: WebhookFormValue) => Promise<void>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [types, setTypes] = useState<Set<WebhookResourceType>>(
    new Set(initial?.resourceTypes ?? []),
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [allTeams, setAllTeams] = useState(initial?.allPublicTeams ?? false);

  const valid = url.trim().length > 0 && types.size > 0;

  async function submit() {
    if (!valid) return;
    await onSave({
      url: url.trim(),
      label: label.trim() || null,
      resourceTypes: [...types],
      enabled,
      allTeams,
    });
  }

  const actionLabel = initial ? 'Save webhook' : 'Create webhook';
  const pendingLabel = initial ? 'Saving…' : 'Creating…';

  return (
    <Modal
      title={initial ? 'Edit webhook' : 'New webhook'}
      description="Set the payload URL and choose which resource types to send."
      teamKey={teamKey}
      onClose={onClose}
      wide
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="webhook-url">Payload URL</Label>
          <Input
            id="webhook-url"
            autoFocus
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/webhook"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="webhook-label">Label</Label>
          <Input
            id="webhook-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <SettingsWebhookResourceTypes value={types} onChange={setTypes} />

        <div className="space-y-3 border-t border-border/50 pt-4">
          {canAllTeams && !initial && (
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <Switch checked={allTeams} onCheckedChange={setAllTeams} />
              <span>All teams, including teams created later</span>
            </label>
          )}
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            <span>Enabled</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border/50 pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || saving}>
            {saving ? pendingLabel : actionLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
