'use client';

import { useSession } from '@/lib/auth-client';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';
import SectionPageView from '@/components/common/page/SectionPageView';
import { useCustomersSettings } from '@/services/customers.service';
import CustomersSettingsGeneral from './components/CustomersSettingsGeneral';
import CustomersSettingsList from './components/CustomersSettingsList';

// Settings → Workspace → Customers (/settings/workspace/customers): the switch, the
// revenue currency, and the customer statuses and tiers. Owners and admins change
// them; members see them read-only.
export default function CustomersSettingsPage() {
  const { data: session, isPending } = useSession();
  const canEdit = isWorkspaceAdmin(toWorkspaceRole(session?.user.workspaceRole));
  const settings = useCustomersSettings();

  return (
    <SectionPageView
      title="Customers"
      description="Group the people who give feedback by the company they work for."
    >
      {(isPending || settings.isPending) && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {settings.data && (
        <div className="flex flex-col gap-10">
          <CustomersSettingsGeneral settings={settings.data} canEdit={canEdit} />
          {settings.data.enabled && (
            <>
              <CustomersSettingsList
                kind="status"
                title="Statuses"
                description="Where each customer is in its relationship with you. New customers get the first status."
                canEdit={canEdit}
              />
              <CustomersSettingsList
                kind="tier"
                title="Tiers"
                description="Groups of customers, such as plans or account sizes."
                canEdit={canEdit}
              />
            </>
          )}
        </div>
      )}
    </SectionPageView>
  );
}
