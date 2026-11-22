'use client';

import type { ReactNode } from 'react';
import type { NotificationPreferences as Prefs } from '@/lib/api';
import { useShell } from '@/context/shellContext';
import { Button } from '@/components/ui/button';
import SectionPageView from '@/components/common/page/SectionPageView';
import NotificationPreferences from './components/notifications/NotificationPreferences';
import { useNotificationPreferencesQuery } from './services/settings.service';
import { useNotificationPreferencesForm } from './hooks/useNotificationPreferencesForm';

// The member's own notification preferences (/team/:teamKey/notifications).
// A main-nav Configuration destination, open to any member: choose which issue events
// you get by email. Email is sent through the instance email provider.
export default function NotificationPreferencesPage() {
  const { team } = useShell();
  if (!team) return null;
  return <PreferencesPage teamKey={team.team.key} />;
}

function Chrome({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <SectionPageView
      title="Notifications"
      description="Choose which issue events you get by email. Email goes to your account address."
      wide
      widthClassName="min-w-[600px] max-w-[60%]"
      actions={actions}
    >
      {children}
    </SectionPageView>
  );
}

function PreferencesPage({ teamKey }: { teamKey: string }) {
  const query = useNotificationPreferencesQuery(teamKey);
  if (!query.data) {
    return (
      <Chrome>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Chrome>
    );
  }
  return <PreferencesLoaded teamKey={teamKey} initial={query.data} />;
}

function PreferencesLoaded({ teamKey, initial }: { teamKey: string; initial: Prefs }) {
  const form = useNotificationPreferencesForm(teamKey, initial);
  return (
    <Chrome
      actions={
        <Button size="sm" onClick={() => void form.save()} disabled={!form.dirty || form.saving}>
          Save
        </Button>
      }
    >
      <NotificationPreferences form={form} />
    </Chrome>
  );
}
