'use client';

import type { ReactNode } from 'react';
import type { NotificationPreferences as Prefs } from '@/features/settings/utils/notificationPreferences';
import { Button } from '@/components/ui/button';
import SectionPageView from '@/components/common/page/SectionPageView';
import NotificationPreferences from './components/notifications/NotificationPreferences';
import { useNotificationPreferencesQuery } from './services/settings.service';
import { useNotificationPreferencesForm } from './hooks/useNotificationPreferencesForm';

// The user's own email notification preferences (/settings/account/notifications).
// They apply to the whole workspace, not only this team: choose which notification
// categories you get by email. Email is sent through the instance email provider.
export default function NotificationPreferencesPage() {
  return <PreferencesPage />;
}

function Chrome({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <SectionPageView
      title="Notifications"
      description="Choose which notifications you get by email, in every team. Email goes to your account address."
      wide
      widthClassName="min-w-[600px] max-w-[60%]"
      actions={actions}
    >
      {children}
    </SectionPageView>
  );
}

function PreferencesPage() {
  const query = useNotificationPreferencesQuery();
  if (!query.data) {
    return (
      <Chrome>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Chrome>
    );
  }
  return <PreferencesLoaded initial={query.data} />;
}

function PreferencesLoaded({ initial }: { initial: Prefs }) {
  const form = useNotificationPreferencesForm(initial);
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
