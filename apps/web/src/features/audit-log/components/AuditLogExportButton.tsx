'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { exportAuditLog } from '../services/auditLog.service';
import type { AuditLogFilters } from '../utils/auditLog';

// Downloads the entries matching the filters as CSV (at most 100,000).
export default function AuditLogExportButton({ filters }: { filters: AuditLogFilters }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await exportAuditLog(filters);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'The export failed');
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Exporting…' : 'Export CSV'}
    </Button>
  );
}
