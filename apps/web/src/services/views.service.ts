import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { View } from '@/types/team';
import { graphql, gqlRequest, readFragment, type FragmentOf } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import type { FilterSet } from '@/utils/filters';
import { filterSetToIssueFilter, issueFilterToFilterSet } from '@/utils/viewFilters';
import {
  collapsePreferences,
  displayToPreferences,
  preferencesToDisplay,
} from '@/utils/viewPreferences';
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

// The ViewPreferencesValues fields the web reads back (utils/viewPreferences.ts),
// shared by saved views and the per-kind list preferences.
export const ViewPreferenceFields = graphql(`
  fragment ViewPreferenceFields on ViewPreferencesValues {
    layout
    viewOrdering
    viewOrderingDirection
    issueGrouping
    issueSubGrouping
    showEmptyGroups
    hiddenColumns
    hiddenGroupsList
    hiddenRows
    columnOrderList
    timelineZoomScale
    showCompletedIssues
    showSubIssues
    fieldId
    fieldStatus
    fieldPriority
    fieldAssignee
    fieldProject
    fieldCycle
    fieldLabels
    fieldCustomerCount
    fieldDueDate
    fieldDateCreated
    fieldDateUpdated
  }
`);

const CustomViewFields = graphql(
  `
    fragment CustomViewFields on CustomView {
      id
      name
      icon
      createdAt
      updatedAt
      shared
      filterData
      team {
        id
        key
        name
      }
      owner {
        id
        displayName
        avatarUrl
      }
      viewPreferencesValues {
        ...ViewPreferenceFields
      }
      organizationViewPreferences {
        preferences {
          hiddenGroupsList
          hiddenRows
        }
      }
    }
  `,
  [ViewPreferenceFields],
);

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

// Creates the view's organization or user preferences, or replaces them when they
// exist.
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
  updatedAt: string;
  shared: boolean;
  filterData: unknown;
  team?: { id: string; key: string; name: string } | null;
  owner?: { id: string; displayName: string; avatarUrl?: string | null } | null;
  viewPreferencesValues?: FragmentOf<typeof ViewPreferenceFields> | null;
  organizationViewPreferences?: {
    preferences: { hiddenGroupsList?: string[] | null; hiddenRows?: string[] | null };
  } | null;
}): View {
  const shared = v.organizationViewPreferences?.preferences;
  return {
    id: v.id,
    teamId: v.team?.id ?? '',
    teamKey: v.team?.key ?? '',
    teamName: v.team?.name ?? '',
    name: v.name,
    icon: v.icon ?? null,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    shared: v.shared,
    owner: v.owner
      ? { id: v.owner.id, name: v.owner.displayName, image: v.owner.avatarUrl ?? null }
      : null,
    filters: issueFilterToFilterSet(v.filterData),
    display: preferencesToDisplay(readFragment(ViewPreferenceFields, v.viewPreferencesValues)),
    sharedCollapse: {
      collapsedGroups: shared?.hiddenGroupsList ?? [],
      collapsedSwimlanes: shared?.hiddenRows ?? [],
    },
  };
}

async function fetchViewNodes(teamKey: string | null): Promise<View[]> {
  const nodes = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(CustomViewsPage, {
      filter: teamKey != null ? { team: { key: { eq: teamKey } } } : undefined,
      after,
      first,
    });
    return data.customViews;
  });
  return nodes.map((n) => toView(readFragment(CustomViewFields, n)));
}

async function fetchViews(teamKey: string): Promise<View[]> {
  const views = await fetchViewNodes(teamKey);
  // Views list in creation order, as their tabs do.
  return views.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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

// The viewer's own collapsed groups and swimlanes on a saved view (their user
// preferences for it, over the view's shared ones).
export async function saveViewCollapse(
  customViewId: string,
  collapse: Pick<SavedViewDisplay, 'collapsedGroups' | 'collapsedSwimlanes'>,
): Promise<void> {
  await gqlRequest(SaveViewPreferences, {
    input: {
      type: 'user',
      viewType: 'customView',
      customViewId,
      preferences: { ...collapsePreferences(collapse) },
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

// Every saved view the viewer can see, across their visible teams (the workspace
// Views page).
export function useAllViewsQuery() {
  return useQuery({ queryKey: qk.allViews(), queryFn: () => fetchViewNodes(null) });
}

function invalidateViews(qc: ReturnType<typeof useQueryClient>, teamKey: string | null) {
  if (teamKey) void qc.invalidateQueries({ queryKey: qk.views(teamKey) });
  void qc.invalidateQueries({ queryKey: qk.allViews() });
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
    onSuccess: () => invalidateViews(qc, teamKey),
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
    onSuccess: () => invalidateViews(qc, teamKey),
  });
}

export function useDeleteView(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => gqlRequest(DeleteView, { id }),
    onSuccess: () => invalidateViews(qc, teamKey),
  });
}
