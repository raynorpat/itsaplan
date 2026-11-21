'use client';

import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import CustomFieldsToolbar from './components/custom-fields/CustomFieldsToolbar';
import SettingsCustomFields from './components/custom-fields/SettingsCustomFields';

const section = settingsSection('custom-fields');

// The Custom fields settings page (/team/:teamKey/settings/custom-fields).
export default function SettingsCustomFieldsPage() {
  const { team } = useShell();
  if (!team) return null;
  return (
    <SectionPageView
      title={section.label}
      description={section.description}
      wide
      widthClassName="min-w-[600px] max-w-[60%]"
      actions={
        <CustomFieldsToolbar
          teamKey={team.team.key}
          resource={section.resource}
          fields={team.customFields}
          types={team.issueTypes}
        />
      }
    >
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <SettingsCustomFields team={team} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
