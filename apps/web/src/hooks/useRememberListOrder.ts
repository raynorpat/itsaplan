'use client';

import { useEffect, useRef } from 'react';
import { rememberListOrder, type ListOrderEntry } from '@/utils/issueNavigation';

// Remembers a board's card order for the issue page and the peek panel (previous /
// next). Written again only when the order of ids changes, not on every render.
export function useRememberListOrder(order: ListOrderEntry[]): void {
  const latest = useRef(order);
  latest.current = order;
  const ids = order.map((e) => e.id).join(' ');
  useEffect(() => {
    rememberListOrder(latest.current);
  }, [ids]);
}
