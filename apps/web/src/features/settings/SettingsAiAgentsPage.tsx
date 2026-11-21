'use client';

import { useShell } from '@/context/shellContext';
import { AI_AGENTS_SECTION } from '@/utils/settingsSections';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import { SettingsCreateAction } from './components/crud/SettingsCreateAction';
import SettingsAiAgents from './components/ai-agents/SettingsAiAgents';
import { SettingsAiAgentSheet } from './components/ai-agents/SettingsAiAgentSheet';

const section = AI_AGENTS_SECTION;

// The AI agents page (/team/:teamKey/ai-agents), a top-level nav item.
export default function SettingsAiAgentsPage() {
  const { team } = useShell();
  if (!team) return null;
  const teamKey = team.team.key;
  return (
    <SectionPageView
      title={section.label}
      description={section.description}
      actions={
        <SettingsCreateAction resource={section.resource} label="New agent">
          {({ open, close }) => (
            <SettingsAiAgentSheet teamKey={teamKey} open={open} agent={null} onClose={close} />
          )}
        </SettingsCreateAction>
      }
      wide
    >
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <SettingsAiAgents team={team} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
