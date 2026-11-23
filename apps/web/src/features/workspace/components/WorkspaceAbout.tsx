import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import type { OrganizationSettings } from '../services/organization.service';
import { useAppVersionQuery } from '@/services/version.service';

// Read-only facts set by the server's environment: the approved email domains and the
// running version.
export default function WorkspaceAbout({ org }: { org: OrganizationSettings }) {
  const versionQuery = useAppVersionQuery();
  const version = versionQuery.data?.version;
  let versionText = '…';
  if (version) versionText = `v${version}`;
  else if (versionQuery.isError) versionText = 'Unknown';
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
        control={<span className="text-sm text-muted-foreground">{versionText}</span>}
      />
    </SettingsCard>
  );
}
