'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { dashboardPath } from '@/utils/paths';
import { TEMPLATES, type DashboardTemplate } from '@/utils/dashboards/templates';
import { cn } from '@/lib/utils';
import { useCreateDashboard, type DashboardSharing } from '../services/dashboards.service';
import DashboardShareFields from './DashboardShareFields';

// Creates a dashboard, blank or from a ready-made template, and opens it.
export default function NewDashboardDialog({
  bugLabelId,
  onClose,
}: {
  bugLabelId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const create = useCreateDashboard();
  const [template, setTemplate] = useState<DashboardTemplate | null>(null);
  const [name, setName] = useState('');
  const [share, setShare] = useState<{ sharedWith: DashboardSharing; teamIds: string[] }>({
    sharedWith: 'workspace',
    teamIds: [],
  });
  const invalid = !name.trim() || (share.sharedWith === 'teams' && share.teamIds.length === 0);

  const pick = (t: DashboardTemplate | null) => {
    setTemplate(t);
    setName(t?.name ?? '');
  };

  return (
    <Modal title="New dashboard" onClose={onClose} wide>
      <div className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {[null, ...TEMPLATES].map((t) => (
            <button
              key={t?.key ?? 'blank'}
              type="button"
              aria-pressed={template?.key === t?.key}
              onClick={() => pick(t)}
              className={cn(
                'rounded-md border p-3 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                template?.key === t?.key && 'border-primary',
              )}
            >
              <span className="font-medium">{t?.name ?? 'Blank'}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t?.description ?? 'Start empty and add widgets.'}
              </span>
            </button>
          ))}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="dashboard-name">Name</Label>
          <Input
            id="dashboard-name"
            value={name}
            maxLength={255}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <DashboardShareFields {...share} onChange={setShare} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={invalid || create.isPending}
            onClick={async () => {
              const created = await create.mutateAsync({
                name: name.trim(),
                description: template?.description ?? '',
                ...share,
                widgets: template ? template.widgets({ bugLabelId }) : [],
              });
              router.push(dashboardPath(created.id));
            }}
          >
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}
