import { useState } from 'react';
import { WEBHOOK_RESOURCE_TYPES, type Webhook, type WebhookResourceType } from '@/lib/api';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

export interface WebhookFormValue {
  url: string;
  resourceTypes: WebhookResourceType[];
  enabled: boolean;
}

// Add/edit dialog for a webhook: the payload URL, the resource types it
// receives, and whether it is enabled. The secret is generated server-side and shown
// on the row, not here.
export function SettingsWebhookDialog({
  teamKey,
  initial,
  saving,
  onSave,
  onClose,
}: {
  teamKey: string;
  initial?: Webhook;
  saving: boolean;
  onSave: (value: WebhookFormValue) => Promise<void>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [types, setTypes] = useState<Set<WebhookResourceType>>(
    new Set(initial?.resourceTypes ?? []),
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  const valid = url.trim().length > 0 && types.size > 0;

  function toggleType(type: WebhookResourceType, on: boolean) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (on) next.add(type);
      else next.delete(type);
      return next;
    });
  }

  async function submit() {
    if (!valid) return;
    await onSave({ url: url.trim(), resourceTypes: [...types], enabled });
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
          <span className="text-sm font-medium">Resource types</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEBHOOK_RESOURCE_TYPES.map((type) => (
              <label key={type.value} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={types.has(type.value)}
                  onCheckedChange={(v) => toggleType(type.value, v === true)}
                />
                <span>{type.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="border-t border-border/50 pt-4">
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
