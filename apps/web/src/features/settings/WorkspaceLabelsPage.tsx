'use client';

import SectionPageView from '@/components/common/page/SectionPageView';
import { useCanManageLabels } from '@/hooks/useCanManageLabels';
import { SettingsAllowedProvider } from './context/settingsPermission';
import SettingsLabels from './components/labels/SettingsLabels';
import { useWorkspaceLabels } from './services/settings.service';

// The workspace labels page (/settings/workspace/labels): labels without a team, which
// every team can use. Changes need the organization's label-management role (the
// API's rule for labels without a team); anyone else sees the list only.
export default function WorkspaceLabelsPage() {
  const canManage = useCanManageLabels();
  const query = useWorkspaceLabels();
  return (
    <SectionPageView
      title="Labels"
      description="Workspace labels, shared by every team."
      wide
      widthClassName="min-w-[600px] max-w-[60%]"
    >
      <SettingsAllowedProvider allowed={canManage}>
        {query.data ? (
          <SettingsLabels teamKey={null} labels={query.data.labels} groups={query.data.groups} />
        ) : (
          <p className="px-3 text-sm text-muted-foreground">
            {query.isError ? 'The labels did not load.' : 'Loading…'}
          </p>
        )}
      </SettingsAllowedProvider>
    </SectionPageView>
  );
}
