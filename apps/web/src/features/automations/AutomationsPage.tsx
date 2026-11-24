'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { Button } from '@/components/ui/button';
import SectionPageView from '@/components/common/page/SectionPageView';
import { settingsSection } from '@/utils/settingsSections';
import { settingsPath } from '@/utils/paths';
import { useAutomationsQuery } from './services/automations.service';
import { useRuleViewer } from './hooks/useRuleViewer';
import { canCreateRule, canEditRule, type WorkflowRule } from './utils/rules';
import AutomationsList from './components/AutomationsList';
import AutomationsArchived from './components/AutomationsArchived';

const section = settingsSection('automations');

// The Automations settings page (/settings/teams/:teamKey/automations): the team's
// workflow rules in run order, and the archived ones.
export default function AutomationsPage() {
  const { team } = useShell();
  const query = useAutomationsQuery(team?.team.id ?? null);
  const viewer = useRuleViewer(team);
  if (!team) return null;

  const canEdit = (rule: WorkflowRule) => viewer != null && canEditRule(rule, viewer);
  const rules = query.data ?? [];
  const active = rules.filter((r) => r.archivedAt == null);
  const archived = rules.filter((r) => r.archivedAt != null);

  let body;
  if (query.isLoading) body = <p className="text-sm text-muted-foreground">Loading…</p>;
  else if (query.isError) body = <p className="text-sm text-destructive">{query.error.message}</p>;
  else if (active.length === 0)
    body = (
      <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        No automations yet. An automation changes issues when they are created or start matching its
        conditions.
      </p>
    );
  else
    body = (
      <AutomationsList
        rules={active}
        teamId={team.team.id}
        teamKey={team.team.key}
        canEdit={canEdit}
      />
    );

  return (
    <SectionPageView
      title={section.label}
      description={section.description}
      wide
      actions={
        viewer != null &&
        canCreateRule(viewer) && (
          <Button asChild size="sm" className="gap-1.5">
            <Link href={settingsPath(team.team.key, 'automations/new')}>
              <Plus className="size-4" />
              New automation
            </Link>
          </Button>
        )
      }
    >
      {body}
      <AutomationsArchived rules={archived} teamKey={team.team.key} canEdit={canEdit} />
    </SectionPageView>
  );
}
