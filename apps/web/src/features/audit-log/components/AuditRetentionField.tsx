'use client';

import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuditSettings, useSaveAuditRetention } from '../services/auditLog.service';
import { AUDIT_RETENTIONS, type AuditRetention } from '../utils/auditLog';

// How long entries are kept. Owners change it; admins see it.
export default function AuditRetentionField({ isOwner }: { isOwner: boolean }) {
  const settings = useAuditSettings(true);
  const save = useSaveAuditRetention();
  const value = settings.data?.retention;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">Keep entries for</span>
      <Select
        value={value}
        disabled={!isOwner || !value || save.isPending}
        onValueChange={(next) =>
          save.mutate(next as AuditRetention, {
            onError: (err) => toast.error(err instanceof Error ? err.message : 'Not saved'),
          })
        }
      >
        <SelectTrigger size="sm" className="h-8 w-32 text-xs" aria-label="Keep entries for">
          <SelectValue placeholder="…" />
        </SelectTrigger>
        <SelectContent>
          {AUDIT_RETENTIONS.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!isOwner && <span className="text-xs text-muted-foreground">Only owners change this.</span>}
    </div>
  );
}
