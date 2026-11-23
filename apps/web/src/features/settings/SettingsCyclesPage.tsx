'use client';

import type { TeamDetail } from '@/lib/api';
import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { Button } from '@/components/ui/button';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import SettingsCycles from './components/cycles/SettingsCycles';
import { useCycleSettingsForm } from './hooks/useCycleSettingsForm';

const section = settingsSection('cycles');

// The Cycles settings page (/team/:teamKey/settings/cycles). Save lives in the page
// header.
export default function SettingsCyclesPage() {
  const { team } = useShell();
  if (!team) return null;
  return <CyclesPage team={team} />;
}

function CyclesPage({ team }: { team: TeamDetail }) {
  const form = useCycleSettingsForm(team);
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
          <SettingsCycles form={form} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
