'use client';

import { useMemo } from 'react';
import { PreferencesError } from '@/components/common/page/PreferencesError';
import { useListPreferences } from '@/hooks/useListPreferences';
import type { ViewSettings } from '@/utils/viewSettings';
import type { MyIssuesTab } from './utils/myIssues';
import MyIssuesTabs from './components/MyIssuesTabs';
import MyIssuesList from './components/MyIssuesList';
import MyIssuesDisplay from './components/MyIssuesDisplay';

// Linear's "My issues" (/my-issues): the viewer's issues across every team, in four
// tabs. The Display menu is the viewer's My issues display, kept on the server and
// shared by the four tabs; both wait until it has loaded.
export default function MyIssuesPage({ tab }: { tab: MyIssuesTab }) {
  const prefs = useListPreferences('myIssues');
  const settings = useMemo(() => {
    const { layout: _layout, ...rest } = prefs.display;
    return rest as ViewSettings;
  }, [prefs.display]);
  const { update } = prefs;
  const setSettings = (next: ViewSettings) => update({ ...next, layout: 'list' });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MyIssuesTabs active={tab}>
        {prefs.ready && (
          <MyIssuesDisplay
            settings={settings}
            onChange={setSettings}
            activity={tab === 'activity'}
          />
        )}
      </MyIssuesTabs>
      {prefs.error && <PreferencesError message={prefs.error} onRetry={prefs.retry} />}
      {prefs.ready && <MyIssuesList tab={tab} settings={settings} onSettingsChange={setSettings} />}
    </div>
  );
}
