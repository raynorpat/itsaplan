'use client';

import type { TeamDetail } from '@/lib/api';
import { settingsSection } from '@/utils/settingsSections';
import { Button } from '@/components/ui/button';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from '../../context/settingsPermission';
import { useCycleSettingsForm } from '../../hooks/useCycleSettingsForm';
import SettingsCycles from './SettingsCycles';

const section = settingsSection('cycles');

// The Cycles settings section for a loaded team. Save lives in the page header.
export default function SettingsCyclesView({ team }: { team: TeamDetail }) {
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
