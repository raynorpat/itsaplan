'use client';

import { useState } from 'react';
import { CircleHelp, Plus } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import SectionPageView from '@/components/common/page/SectionPageView';
import { settingsSection } from '@/utils/settingsSections';
import { isWorkspaceAdmin } from '@/utils/workspaceRoles';
import { usePipelineSettings, type PipelineSettings } from './services/releasesSettings.service';
import PipelineSettingsCard from './components/PipelineSettingsCard';
import PipelineDialog from './components/PipelineDialog';
import ReleaseSyncHelpDialog from './components/ReleaseSyncHelpDialog';

const section = settingsSection('releases');

// Team settings → Releases (/settings/teams/:teamKey/releases): the team's release
// pipelines with their settings, stages and CI access keys. Guests read only; access
// keys are created and revoked by workspace owners and admins.
export default function ReleasesSettingsPage() {
  const { team } = useShell();
  const { workspaceRole } = usePermissions();
  const query = usePipelineSettings(team?.team.id ?? null);
  const [editing, setEditing] = useState<PipelineSettings | 'new' | null>(null);
  const [help, setHelp] = useState(false);
  if (!team) return null;

  const canEdit = workspaceRole != null && workspaceRole !== 'guest';
  const canManageKeys = workspaceRole != null && isWorkspaceAdmin(workspaceRole);
  const pipelines = query.data ?? [];

  let body;
  if (query.isLoading) body = <p className="text-sm text-muted-foreground">Loading…</p>;
  else if (query.isError) body = <p className="text-sm text-destructive">{query.error.message}</p>;
  else if (pipelines.length === 0)
    body = (
      <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        No release pipelines yet. A pipeline groups the releases of one place you ship to, such as
        Production or the iOS app.
      </p>
    );
  else
    body = (
      <div className="flex flex-col gap-4">
        {pipelines.map((p) => (
          <PipelineSettingsCard
            key={p.id}
            pipeline={p}
            canEdit={canEdit}
            canManageKeys={canManageKeys}
            onEdit={() => setEditing(p)}
          />
        ))}
      </div>
    );

  return (
    <SectionPageView
      title={section.label}
      description={section.description}
      wide
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setHelp(true)}>
            <CircleHelp className="size-4" aria-hidden />
            Syncing from CI
          </Button>
          {canEdit && (
            <Button size="sm" className="gap-1.5" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              New pipeline
            </Button>
          )}
        </div>
      }
    >
      {body}
      {editing && (
        <PipelineDialog
          teamId={team.team.id}
          pipeline={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {help && <ReleaseSyncHelpDialog onClose={() => setHelp(false)} />}
    </SectionPageView>
  );
}
