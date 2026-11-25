'use client';

import Modal from '@/components/common/overlay/Modal';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { usePortalUpdates, useSetPortalUpdates } from '../../services/portal.service';
import { updatesSummary } from '../../utils/updates';
import PortalCadencePicker from '../PortalCadencePicker';

// The account menu's "Email updates": the main switch, change emails and the summary.
export default function PortalUpdatesDialog({ onClose }: { onClose: () => void }) {
  const prefs = usePortalUpdates(true);
  const set = useSetPortalUpdates();
  const data = prefs.data;
  return (
    <Modal
      title="Email updates"
      description="Emails about the requests you voted on, suggested or commented on."
      onClose={onClose}
    >
      {!data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Switch
              id="portal-updates"
              checked={data.enabled}
              disabled={set.isPending}
              onCheckedChange={(enabled) => set.mutate({ enabled })}
            />
            <div className="grid gap-0.5">
              <Label htmlFor="portal-updates">Send me email updates</Label>
              <p className="text-xs text-muted-foreground">{updatesSummary(data)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="portal-change-emails"
              checked={data.changeEmails}
              disabled={!data.enabled || set.isPending}
              onCheckedChange={(changeEmails) => set.mutate({ changeEmails })}
            />
            <Label htmlFor="portal-change-emails">When a request changes or gets a reply</Label>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">Summary email</span>
            <PortalCadencePicker
              value={data.summary}
              disabled={!data.enabled || set.isPending}
              onChange={(summary) => set.mutate({ summary })}
            />
          </div>
          {set.error && (
            <p className="text-sm text-destructive" role="alert">
              {set.error.message}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
