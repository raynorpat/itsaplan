'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import SectionPageView from '@/components/common/page/SectionPageView';
import { settingsPath } from '@/utils/paths';
import { Button } from '@/components/ui/button';
import { useAutomationQuery, useUnarchiveAutomation } from '../services/automations.service';
import { useRuleViewer } from '../hooks/useRuleViewer';
import { canCreateRule, canEditRule } from '../utils/rules';
import AutomationEditorForm from './AutomationEditorForm';

// The automation editor page: /settings/teams/:teamKey/automations/new creates a rule,
// /…/automations/:ruleId shows one, editable when the viewer's rights allow it
// (apps/api/src/workflows/access.ts), read-only otherwise.
export default function AutomationEditor() {
  const params = useParams();
  const ruleId = typeof params.ruleId === 'string' ? params.ruleId : null;
  const { team } = useShell();
  const viewer = useRuleViewer(team);
  const query = useAutomationQuery(ruleId);
  const unarchive = useUnarchiveAutomation(team?.team.id ?? '');
  if (!team) return null;

  const listHref = settingsPath(team.team.key, 'automations');
  const rule = ruleId ? (query.data ?? null) : null;

  let body;
  if (ruleId && query.isLoading) body = <p className="text-sm text-muted-foreground">Loading…</p>;
  else if (ruleId && !rule)
    body = (
      <p className="text-sm text-muted-foreground">
        {query.error?.message ?? 'This automation was not found.'}
      </p>
    );
  else if (!viewer) body = <p className="text-sm text-muted-foreground">Loading…</p>;
  else {
    const editable = rule ? canEditRule(rule, viewer) : canCreateRule(viewer);
    body = (
      <>
        {rule?.archivedAt && (
          <div
            role="status"
            className="mb-4 flex max-w-3xl items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
          >
            <span>This automation is archived and does not run.</span>
            {editable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={unarchive.isPending}
                onClick={() => unarchive.mutate(rule.id)}
              >
                Unarchive
              </Button>
            )}
          </div>
        )}
        <AutomationEditorForm
          key={rule?.id ?? 'new'}
          team={team}
          rule={rule}
          editable={editable}
          managesAccess={canCreateRule(viewer)}
          listHref={listHref}
        />
      </>
    );
  }

  return (
    <SectionPageView
      title={rule?.name ?? (ruleId ? 'Automation' : 'New automation')}
      description={
        <Link
          href={listHref}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          Automations
        </Link>
      }
    >
      {body}
    </SectionPageView>
  );
}
