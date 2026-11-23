'use client';

import { useEffect, useState } from 'react';
import type { Notification } from '@/types/notification';
import { nextWakeUp } from '@/utils/notifications';

// The current time for snooze checks. It moves forward when the earliest snooze in
// the list expires (a snooze ending changes no server row, so nothing else would
// re-render the inbox or the badge) and once a minute as a fallback.
export function useSnoozeClock(list: Notification[] | undefined): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const minute = setInterval(tick, 60_000);
    const wake = list ? nextWakeUp(list, new Date()) : null;
    const timer = wake != null ? setTimeout(tick, Math.max(0, wake - Date.now()) + 50) : null;
    return () => {
      clearInterval(minute);
      if (timer) clearTimeout(timer);
    };
  }, [list, now]);
  return now;
}
