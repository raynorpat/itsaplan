import { instanceFetch } from '@/lib/auth-client';

// Records a CSV download in the workspace audit log
// (/api/auth/instance/audit/export-recorded). The download never waits for it and a
// failed report is ignored: the person's own copy of data they can already see.
export function reportWidgetExport(input: { id: string; name: string; rows: number }): void {
  void instanceFetch('/instance/audit/export-recorded', {
    method: 'POST',
    body: { kind: 'widget', ...input },
  }).catch(() => {});
}
