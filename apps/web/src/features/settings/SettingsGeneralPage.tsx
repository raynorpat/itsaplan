'use client';

import type { TeamDetail } from '@/types/team';
import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { Button } from '@/components/ui/button';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import SettingsGeneral from './components/general/SettingsGeneral';
import SettingsVisibility from './components/general/SettingsVisibility';
import { useGeneralForm } from './hooks/useGeneralForm';
import { useVisibilityToggle } from './hooks/useVisibilityToggle';

const section = settingsSection('general');

// The General settings page (/team/:teamKey/settings/general). Edits the
// team name and description; the key is shown read-only. Save lives in the page
// header.
export default function SettingsGeneralPage() {
  const { team } = useShell();
  if (!team) return null;
  return <GeneralPage team={team} />;
}

function GeneralPage({ team }: { team: TeamDetail }) {
  const form = useGeneralForm(team);
  const visibility = useVisibilityToggle(team);
  return (
    <SectionPageView
      title={section.label}
      description={section.description}
      wide
      widthClassName="min-w-[600px] max-w-[60%]"
      actions={
        form.editable ? (
          <Button size="sm" onClick={() => void form.save()} disabled={!form.canSave}>
            Save
          </Button>
        ) : undefined
      }
    >
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <div className="space-y-10">
            <SettingsGeneral form={form} />
            <SettingsVisibility form={visibility} />
          </div>
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
