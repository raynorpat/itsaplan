import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { toOrganizationInput, toOrganizationSettings } from '../utils/organization';

const OrganizationQuery = graphql(`
  query OrganizationSettings {
    organization {
      id
      name
      urlKey
      logoUrl
      allowedFileUploadContentTypes
      createdAt
      updatedAt
      authSettings
      securitySettings
    }
  }
`);

const OrganizationUpdate = graphql(`
  mutation OrganizationSettingsUpdate($input: OrganizationUpdateInput!) {
    organizationUpdate(input: $input) {
      organization {
        id
        name
        urlKey
        logoUrl
        allowedFileUploadContentTypes
        createdAt
        updatedAt
        authSettings
        securitySettings
      }
    }
  }
`);

// The workspace settings (Linear's Organization): read by any signed-in user,
// changed by owners and admins.
export function useOrganizationQuery() {
  return useQuery({
    queryKey: qk.organization,
    queryFn: async () => toOrganizationSettings((await gqlRequest(OrganizationQuery)).organization),
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: OrganizationSettingsPatch) => {
      const data = await gqlRequest(OrganizationUpdate, {
        input: toOrganizationInput(patch),
      });
      const organization = data.organizationUpdate.organization;
      if (!organization) throw new Error('Could not save');
      return toOrganizationSettings(organization);
    },
    onSuccess: (data) => {
      qc.setQueryData(qk.organization, data);
      // The workspace menu shows the name and logo.
      void qc.invalidateQueries({ queryKey: qk.viewerWorkspace });
      toast.success('Workspace settings saved');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not save'),
  });
}

// The minimum workspace role for an action.
export type MinimumRole = 'owner' | 'admin' | 'member';

// The workspace settings. Readable by any signed-in user; changed by owners and
// admins. approvedDomains (from the environment) is read-only.
export interface OrganizationSettings {
  id: string;
  name: string;
  urlKey: string;
  logoUrl: string | null;
  // 'email' (magic link), 'google', 'passkey'. Empty means every configured one.
  allowedAuthServices: string[];
  allowedFileUploadContentTypes: string[];
  teamCreationRole: MinimumRole;
  labelManagementRole: MinimumRole;
  invitationsRole: MinimumRole;
  approvedDomains: string[];
  createdAt: string;
  updatedAt: string;
}

export type OrganizationSettingsPatch = Partial<
  Pick<
    OrganizationSettings,
    | 'name'
    | 'urlKey'
    | 'logoUrl'
    | 'allowedAuthServices'
    | 'allowedFileUploadContentTypes'
    | 'teamCreationRole'
    | 'labelManagementRole'
    | 'invitationsRole'
  >
>;
