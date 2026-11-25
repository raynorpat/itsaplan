// The labels New dashboard offers for the Bugs template: every active label the viewer
// can read (workspace and team labels), named with its team key.

import { useQuery } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';

export interface LabelChoice {
  id: string;
  name: string;
  teamKey: string | null;
}

const LabelChoicesPage = graphql(`
  query DashboardLabelChoices($after: String, $first: Int) {
    issueLabels(first: $first, after: $after) {
      nodes {
        id
        name
        isGroup
        team {
          key
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

export function useLabelChoices(enabled: boolean) {
  return useQuery({
    queryKey: qk.labelChoices,
    queryFn: async (): Promise<LabelChoice[]> => {
      const nodes = await fetchAllPages(async (after, first) => {
        const { issueLabels } = await gqlRequest(LabelChoicesPage, { after, first });
        return issueLabels;
      });
      return nodes
        .filter((l) => !l.isGroup)
        .map((l) => ({ id: l.id, name: l.name, teamKey: l.team?.key ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled,
  });
}
