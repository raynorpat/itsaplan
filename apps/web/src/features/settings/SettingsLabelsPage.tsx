'use client';
import { teamOwnGroups, teamOwnLabels } from '@/utils/labels';

import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import LabelsToolbar from './components/labels/LabelsToolbar';
import SettingsLabels from './components/labels/SettingsLabels';

const section = settingsSection('labels');

// The Labels settings page (/settings/teams/:teamKey/labels).
export default function SettingsLabelsPage() {
  const { team } = useShell();
  if (!team) return null;
  return (
    <SectionPageView
      title={section.label}
      description={section.description}
      wide
      widthClassName="min-w-[600px] max-w-[60%]"
      actions={
        <LabelsToolbar
          teamKey={team.team.key}
          resource={section.resource}
          groups={teamOwnGroups(team.labelGroups)}
          labels={teamOwnLabels(team.labels)}
        />
      }
    >
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <SettingsLabels team={team} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
