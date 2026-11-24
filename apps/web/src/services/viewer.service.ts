'use client';

import { useQuery } from '@tanstack/react-query';
import { gqlRequest, graphql } from '@/lib/graphql';
import { useSession } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import { roleFromFlags } from '@/utils/members';
import type { WorkspaceRole } from '@/types/workspace';

const ViewerWorkspace = graphql(`
  query ViewerWorkspace {
    viewer {
      owner
      admin
      guest
    }
    organization {
      name
      logoUrl
    }
  }
`);

export type ViewerWorkspace = {
  workspaceRole: WorkspaceRole;
  organization: { name: string; logoUrl: string | null };
};

// The viewer's workspace role and the workspace's name and logo, for the chrome that
// renders with or without a team (the workspace menu, the Settings sidebar). Team
// pages read the role from the team's scaffold instead (usePermissions).
export function useViewerWorkspaceQuery() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: qk.viewerWorkspace,
    queryFn: async (): Promise<ViewerWorkspace> => {
      const data = await gqlRequest(ViewerWorkspace);
      return {
        workspaceRole: roleFromFlags(data.viewer),
        organization: {
          name: data.organization.name,
          logoUrl: data.organization.logoUrl ?? null,
        },
      };
    },
    enabled: Boolean(session),
  });
}
