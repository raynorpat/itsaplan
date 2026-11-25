'use client';

import type { TeamDetail } from '@/types/team';
import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { Button } from '@/components/ui/button';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import SettingsEstimates from './components/estimates/SettingsEstimates';
import { useEstimateSettingsForm } from './hooks/useEstimateSettingsForm';

const section = settingsSection('estimates');

// The Estimates settings page (/settings/teams/:teamKey/estimates). Save lives in the
// page header.
export default function SettingsEstimatesPage() {
  const { team } = useShell();
  if (!team) return null;
  return <EstimatesPage team={team} />;
}

function EstimatesPage({ team }: { team: TeamDetail }) {
  const form = useEstimateSettingsForm(team);
  return (
    <SectionPageView
      title={section.label}
      description={section.description}
      wide
      widthClassName="min-w-[600px] max-w-[60%]"
      actions={
        form.editable ? (
          <Button size="sm" onClick={() => void form.save()} disabled={form.saving}>
            Save
          </Button>
        ) : undefined
      }
    >
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <SettingsEstimates form={form} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
