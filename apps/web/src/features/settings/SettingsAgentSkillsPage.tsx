'use client';

import { useShell } from '@/context/shellContext';
import { AGENT_SKILLS_SECTION } from '@/utils/settingsSections';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import { SettingsCreateAction } from './components/crud/SettingsCreateAction';
import SettingsAgentSkills from './components/agent-skills/SettingsAgentSkills';
import { SkillCreateDialog } from './components/agent-skills/SkillCreateDialog';

const section = AGENT_SKILLS_SECTION;

// The agent skills page (/team/:teamKey/agent-skills): the team skill
// library given to internal agents.
export default function SettingsAgentSkillsPage() {
  const { team } = useShell();
  if (!team) return null;
  const teamKey = team.team.key;
  return (
    <SectionPageView
      title={section.label}
      description={section.description}
      actions={
        <SettingsCreateAction resource={section.resource} label="New skill">
          {({ open, close }) => open && <SkillCreateDialog teamKey={teamKey} onClose={close} />}
        </SettingsCreateAction>
      }
      wide
    >
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <SettingsAgentSkills team={team} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
