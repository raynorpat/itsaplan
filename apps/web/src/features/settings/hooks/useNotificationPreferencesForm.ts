'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type {
  EmailCategories,
  NotificationPreferences,
} from '@/features/settings/utils/notificationPreferences';
import { useUpdateNotificationPreferences } from '../services/settings.service';
import { categoriesEqual } from '../utils/notificationEvents';

export interface NotificationPreferencesForm {
  emailCategories: EmailCategories;
  setEmailCategories: (v: EmailCategories) => void;
  dirty: boolean;
  saving: boolean;
  save: () => Promise<void>;
}

// Form state for the user's own email notification preferences. Shared between the
// header Save button and the body checkboxes, so it lives in a hook.
export function useNotificationPreferencesForm(
  initial: NotificationPreferences,
): NotificationPreferencesForm {
  const update = useUpdateNotificationPreferences();
  const [emailCategories, setEmailCategories] = useState<EmailCategories>(initial.emailCategories);

  const dirty = !categoriesEqual(emailCategories, initial.emailCategories);

  async function save() {
    await update.mutateAsync({ emailCategories });
    toast.success('Notification preferences saved');
  }

  return { emailCategories, setEmailCategories, dirty, saving: update.isPending, save };
}
