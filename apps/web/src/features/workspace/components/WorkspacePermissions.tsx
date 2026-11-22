'use client';

import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import type { MinimumRole, OrganizationSettings } from '@/lib/api';
import { useUpdateOrganization } from '../services/organization.service';
import WorkspaceRoleSelect from './WorkspaceRoleSelect';

const ACTIONS = [
  {
    key: 'teamCreationRole',
    title: 'Create teams',
    description: 'Who may create a team.',
  },
  {
    key: 'labelManagementRole',
    title: 'Manage labels',
    description: 'Who may change workspace labels, project labels and project statuses.',
  },
  {
    key: 'invitationsRole',
    title: 'Invite people',
    description: 'Who may invite people to the workspace. Guests never can.',
  },
] as const;

// Who may create teams, manage labels and invite, as a minimum workspace role.
export default function WorkspacePermissions({ org }: { org: OrganizationSettings }) {
  const update = useUpdateOrganization();

  return (
    <SettingsCard className="divide-y divide-border/60">
      {ACTIONS.map((a) => (
        <SettingsRow
          key={a.key}
          title={a.title}
          description={a.description}
          control={
            <WorkspaceRoleSelect
              value={org[a.key]}
              disabled={update.isPending}
              onChange={(role: MinimumRole) => update.mutate({ [a.key]: role })}
            />
          }
        />
      ))}
    </SettingsCard>
  );
}
