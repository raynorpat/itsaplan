import { graphql, gqlRequest, gqlRequestKeepalive, readFragment } from '@/lib/graphql';
import type { ListViewType } from '@/utils/listPreferences';
import type { ViewPreferenceValues } from '@/utils/viewPreferences';
import { ViewPreferenceFields } from './views.service';

// The viewer's personal display preferences for one list kind (Linear's
// userViewPreferences); null when the viewer never changed that kind of list.
const ListPreferences = graphql(
  `
    query ListPreferences($viewType: ViewType!) {
      userViewPreferences(viewType: $viewType) {
        id
        preferences {
          ...ViewPreferenceFields
        }
      }
    }
  `,
  [ViewPreferenceFields],
);

// Creates the viewer's record for the list kind, or replaces it when it exists.
const SaveListPreferences = graphql(`
  mutation SaveListPreferences($input: ViewPreferencesCreateInput!) {
    viewPreferencesCreate(input: $input) {
      success
    }
  }
`);

export async function fetchListPreferences(
  viewType: ListViewType,
): Promise<ViewPreferenceValues | null> {
  const data = await gqlRequest(ListPreferences, { viewType });
  const record = data.userViewPreferences;
  return record ? readFragment(ViewPreferenceFields, record.preferences) : null;
}

// keepalive: the page is being hidden or closed (see gqlRequestKeepalive).
export async function saveListPreferences(
  viewType: ListViewType,
  preferences: ViewPreferenceValues,
  keepalive = false,
): Promise<void> {
  const variables = { input: { type: 'user' as const, viewType, preferences: { ...preferences } } };
  if (keepalive) await gqlRequestKeepalive(SaveListPreferences, variables);
  else await gqlRequest(SaveListPreferences, variables);
}
