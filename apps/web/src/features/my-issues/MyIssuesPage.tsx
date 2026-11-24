'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PreferencesError } from '@/components/common/page/PreferencesError';
import { useListPreferences } from '@/hooks/useListPreferences';
import type { ViewSettings } from '@/utils/viewSettings';
import type { MyIssuesTab } from './utils/myIssues';
import MyIssuesTabs from './components/MyIssuesTabs';
import MyIssuesList from './components/MyIssuesList';
import MyIssuesDisplay from './components/MyIssuesDisplay';
import { myIssuesFilter } from './utils/myIssues';
import InsightsButton from '@/features/insights/components/InsightsButton';
import InsightsPanel from '@/features/insights/components/InsightsPanel';
import { useInsightsSettings } from '@/features/insights/hooks/useInsightsSettings';
import { insightsViewKey } from '@/features/insights/utils/settings';
import { EMPTY_CONTEXT } from '@/features/insights/utils/context';
import type { InsightIssue } from '@/features/insights/utils/slices';

// My issues' rows are not in the panel's form, so the panel fetches the tab's open
// issues itself.
const NO_VIEW_ISSUES: InsightIssue[] = [];

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
  const router = useRouter();
  const insightsKey = insightsViewKey({ kind: 'myIssues' });
  const insights = useInsightsSettings(insightsKey);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MyIssuesTabs active={tab}>
        <InsightsButton
          open={insights.settings.open}
          onToggle={() => insights.update({ open: !insights.settings.open })}
        />
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
      {insights.settings.open && (
        <InsightsPanel
          viewKey={`${insightsKey}:${tab}`}
          settings={insights.settings}
          onChange={insights.update}
          scope={myIssuesFilter(tab, true)}
          viewIssues={NO_VIEW_ISSUES}
          baseContext={EMPTY_CONTEXT}
          spansTeams
          fetchOpen
          onOpenIssue={(id) => router.push(`/issue/${id}`)}
        />
      )}
    </div>
  );
}
