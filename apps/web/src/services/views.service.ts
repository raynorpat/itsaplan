import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { View } from '@/lib/api';
import { graphql, gqlRequest, readFragment } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import type { FilterSet } from '@/utils/filters';
import { filterSetToIssueFilter, issueFilterToFilterSet } from '@/utils/viewFilters';
import { displayToPreferences, preferencesToDisplay } from '@/utils/viewPreferences';
import type { SavedViewDisplay } from '@/utils/viewSettings';

// Saved views on Linear's CustomView: the filter is the view's filterData (through the
// filter converter), the display its organization view preferences.

export interface NewViewInput {
  name: string;
  icon?: string | null;
  filters?: FilterSet;
  display?: SavedViewDisplay;
}

export type ViewPatch = Partial<NewViewInput>;

const CustomViewFields = graphql(`
  fragment CustomViewFields on CustomView {
    id
    name
    icon
    createdAt
    filterData
    team {
      id
    }
    viewPreferencesValues {
      layout
      viewOrdering
      viewOrderingDirection
      issueGrouping
      issueSubGrouping
      showEmptyGroups
      hiddenColumns
      columnOrderList
      timelineZoomScale
      fieldId
      fieldStatus
      fieldPriority
      fieldAssignee
      fieldProject
      fieldLabels
      fieldDueDate
      fieldDateCreated
      fieldDateUpdated
    }
  }
`);

const CustomViewsPage = graphql(
  `
    query CustomViews($filter: CustomViewFilter, $after: String, $first: Int) {
      customViews(filter: $filter, first: $first, after: $after) {
        nodes {
          ...CustomViewFields
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  [CustomViewFields],
);

const CreateView = graphql(`
  mutation CreateView($input: CustomViewCreateInput!) {
    customViewCreate(input: $input) {
      customView {
        id
      }
    }
  }
`);

const UpdateView = graphql(`
  mutation UpdateView($id: String!, $input: CustomViewUpdateInput!) {
    customViewUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const DeleteView = graphql(`
  mutation DeleteView($id: String!) {
    customViewDelete(id: $id) {
      success
    }
  }
`);

// Creates the view's organization preferences, or replaces them when they exist.
const SaveViewPreferences = graphql(`
  mutation SaveViewPreferences($input: ViewPreferencesCreateInput!) {
    viewPreferencesCreate(input: $input) {
      success
    }
  }
`);

function toView(v: {
  id: string;
  name: string;
  icon?: string | null;
  createdAt: string;
  filterData: unknown;
  team?: { id: string } | null;
  viewPreferencesValues?: Parameters<typeof preferencesToDisplay>[0];
}): View {
  return {
    id: v.id,
    teamId: v.team?.id ?? '',
    name: v.name,
    icon: v.icon ?? null,
    createdAt: v.createdAt,
    filters: issueFilterToFilterSet(v.filterData),
    display: preferencesToDisplay(v.viewPreferencesValues),
  };
}

async function fetchViews(teamKey: string): Promise<View[]> {
  const nodes = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(CustomViewsPage, {
      filter: { team: { key: { eq: teamKey } } },
      after,
      first,
    });
    return data.customViews;
  });
  // Views list in creation order, as their tabs do.
  return nodes
    .map((n) => toView(readFragment(CustomViewFields, n)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function saveDisplay(customViewId: string, display: SavedViewDisplay | undefined) {
  if (!display) return;
  await gqlRequest(SaveViewPreferences, {
    input: {
      type: 'organization',
      viewType: 'customView',
      customViewId,
      preferences: { ...displayToPreferences(display) },
    },
  });
}

export function useViewsQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.views(teamKey ?? ''),
    queryFn: () => fetchViews(teamKey!),
    enabled: teamKey != null,
  });
}

export function useCreateView(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    // Resolves with the new view's id.
    mutationFn: async ({ input }: { input: NewViewInput }) => {
      const data = await gqlRequest(CreateView, {
        input: {
          // Linear's teamId takes the team's key too.
          teamId: teamKey!,
          name: input.name,
          icon: input.icon ?? null,
          filterData: filterSetToIssueFilter(input.filters ?? { conditions: [] }),
        },
      });
      const id = data.customViewCreate.customView.id;
      try {
        await saveDisplay(id, input.display);
      } catch (err) {
        // Creating a view is one action for the user: a view whose display could not
        // be saved is removed again, so retrying does not leave a duplicate.
        await gqlRequest(DeleteView, { id }).catch(() => undefined);
        throw err;
      }
      return id;
    },
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.views(teamKey) });
    },
  });
}

export function useUpdateView(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ViewPatch }) => {
      const { display, filters, ...rest } = input;
      await gqlRequest(UpdateView, {
        id,
        input: {
          ...rest,
          ...(filters ? { filterData: filterSetToIssueFilter(filters) } : {}),
        },
      });
      await saveDisplay(id, display);
    },
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.views(teamKey) });
    },
  });
}

export function useDeleteView(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => gqlRequest(DeleteView, { id }),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.views(teamKey) });
    },
  });
}
