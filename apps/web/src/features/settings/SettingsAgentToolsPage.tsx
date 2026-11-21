'use client';

import { useShell } from '@/context/shellContext';
import { AGENT_TOOLS_SECTION } from '@/utils/settingsSections';
import { useIntegrationCatalogQuery, useCredentialsQuery } from '@/services/integrations.service';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import { SettingsCreateAction } from './components/crud/SettingsCreateAction';
import SettingsAgentTools from './components/agent-tools/SettingsAgentTools';
import { ToolConfigDialog } from './components/agent-tools/ToolConfigDialog';

const section = AGENT_TOOLS_SECTION;

// The custom tools page (/team/:teamKey/agent-tools): external integrations
// internal agents can call, configured once per team.
export default function SettingsAgentToolsPage() {
  const { team } = useShell();
  const key = team?.team.key ?? null;
  const catalog = useIntegrationCatalogQuery(key).data ?? [];
  const credentials = useCredentialsQuery(key).data ?? [];
  if (!team) return null;
  const teamKey = team.team.key;
  return (
    <SectionPageView
      title={section.label}
      description={section.description}
      actions={
        <SettingsCreateAction resource={section.resource} label="Add tool">
          {({ open, close }) =>
            open && (
              <ToolConfigDialog
                teamKey={teamKey}
                catalog={catalog}
                credentials={credentials}
                onClose={close}
              />
            )
          }
        </SettingsCreateAction>
      }
      wide
    >
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <SettingsAgentTools team={team} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
