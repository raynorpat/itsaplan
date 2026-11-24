'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/lib/auth-client';
import {
  DEFAULT_INSIGHTS_SETTINGS,
  readInsightsSettings,
  settingsForKey,
  writeInsightsSettings,
  type InsightsSettings,
} from '../utils/settings';

// A view's Insights settings, kept in this browser per signed-in user and view.
export function useInsightsSettings(viewKey: string) {
  const userId = useSession().data?.user.id ?? null;
  // Read after mount: the server render has no storage, and a client-only first value
  // would not match its markup. `key` is the view the held settings were read for.
  const [held, setHeld] = useState<{ key: string | null; settings: InsightsSettings }>({
    key: null,
    settings: DEFAULT_INSIGHTS_SETTINGS,
  });
  useEffect(
    () => setHeld({ key: viewKey, settings: readInsightsSettings(userId, viewKey) }),
    [userId, viewKey],
  );

  const update = useCallback(
    (patch: Partial<InsightsSettings>) =>
      setHeld((current) => {
        const read = (key: string) => readInsightsSettings(userId, key);
        const next = { ...settingsForKey(current, viewKey, read), ...patch };
        writeInsightsSettings(userId, viewKey, next);
        return { key: viewKey, settings: next };
      }),
    [userId, viewKey],
  );

  const settings = held.key === viewKey ? held.settings : DEFAULT_INSIGHTS_SETTINGS;
  return { settings, update };
}
