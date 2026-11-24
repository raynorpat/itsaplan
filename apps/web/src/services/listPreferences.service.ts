import { graphql, gqlRequest, readFragment } from '@/lib/graphql';
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

export async function saveListPreferences(
  viewType: ListViewType,
  preferences: ViewPreferenceValues,
): Promise<void> {
  await gqlRequest(SaveListPreferences, {
    input: { type: 'user', viewType, preferences: { ...preferences } },
  });
}
