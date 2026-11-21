'use client';

import { useShell } from '@/context/shellContext';
import { INTEGRATIONS_SECTION } from '@/utils/settingsSections';
import { useIntegrationCatalogQuery } from '@/services/integrations.service';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import { SettingsCreateAction } from './components/crud/SettingsCreateAction';
import SettingsIntegrations from './components/integrations/SettingsIntegrations';
import { CredentialDialog } from './components/integrations/CredentialDialog';

const section = INTEGRATIONS_SECTION;

// The integrations page (/team/:teamKey/integrations): stored credentials for
// AI providers and tool integrations.
export default function SettingsIntegrationsPage() {
  const { team } = useShell();
  const catalog = useIntegrationCatalogQuery(team?.team.key ?? null).data ?? [];
  if (!team) return null;
  const teamKey = team.team.key;
  return (
    <SectionPageView
      title={section.label}
      description={section.description}
      actions={
        <SettingsCreateAction resource={section.resource} label="Add credential">
          {({ open, close }) =>
            open && (
              <CredentialDialog
                teamKey={teamKey}
                catalog={catalog}
                existing={null}
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
          <SettingsIntegrations team={team} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
