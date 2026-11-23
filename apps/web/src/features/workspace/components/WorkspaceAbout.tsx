import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import type { OrganizationSettings } from '@/lib/api';
import { useAppVersionQuery } from '@/services/version.service';

// Read-only facts set by the server's environment: the approved email domains and the
// running version.
export default function WorkspaceAbout({ org }: { org: OrganizationSettings }) {
  const version = useAppVersionQuery().data?.version;
  return (
    <SettingsCard className="divide-y divide-border/60">
      <SettingsRow
        title="Approved email domains"
        description="People with an email on these domains can join as members. Set with APPROVED_EMAIL_DOMAINS."
        control={
          <span className="text-sm text-muted-foreground">
            {org.approvedDomains.length ? org.approvedDomains.join(', ') : 'None'}
          </span>
        }
      />
      <SettingsRow
        title="Version"
        description="The version this instance runs."
        control={
          <span className="text-sm text-muted-foreground">{version ? `v${version}` : '…'}</span>
        }
      />
    </SettingsCard>
  );
}
