'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { NotificationEventToggles, NotificationPreferences } from '@/lib/api';
import { useUpdateNotificationPreferences } from '../services/settings.service';
import { eventsEqual } from '../utils/notificationEvents';

export interface NotificationPreferencesForm {
  emailEvents: NotificationEventToggles;
  setEmailEvents: (v: NotificationEventToggles) => void;
  dirty: boolean;
  saving: boolean;
  save: () => Promise<void>;
}

// Form state for the member's own notification preferences. Shared between the
// header Save button and the body checkboxes, so it lives in a hook.
export function useNotificationPreferencesForm(
  teamKey: string,
  initial: NotificationPreferences,
): NotificationPreferencesForm {
  const update = useUpdateNotificationPreferences(teamKey);
  const [emailEvents, setEmailEvents] = useState<NotificationEventToggles>(initial.emailEvents);

  const dirty = !eventsEqual(emailEvents, initial.emailEvents);

  async function save() {
    await update.mutateAsync({ emailEvents });
    toast.success('Notification preferences saved');
  }

  return {
    emailEvents,
    setEmailEvents,
    dirty,
    saving: update.isPending,
    save,
  };
}
