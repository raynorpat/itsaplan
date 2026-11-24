'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_INSIGHTS_SETTINGS,
  readInsightsSettings,
  writeInsightsSettings,
  type InsightsSettings,
} from '../utils/settings';

// A view's Insights settings, kept in this browser under the view's key.
export function useInsightsSettings(viewKey: string) {
  // Read after mount: the server render has no storage, and a client-only first value
  // would not match its markup.
  const [settings, setSettings] = useState<InsightsSettings>(DEFAULT_INSIGHTS_SETTINGS);
  useEffect(() => setSettings(readInsightsSettings(viewKey)), [viewKey]);

  const update = useCallback(
    (patch: Partial<InsightsSettings>) =>
      setSettings((current) => {
        const next = { ...current, ...patch };
        writeInsightsSettings(viewKey, next);
        return next;
      }),
    [viewKey],
  );

  return { settings, update };
}
