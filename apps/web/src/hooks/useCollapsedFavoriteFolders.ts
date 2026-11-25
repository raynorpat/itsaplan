'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'sidebar.favorites.collapsed';

// The ids of the favorite folders the person collapsed, kept in the browser.
export function useCollapsedFavoriteFolders() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      const ids = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(ids)) setCollapsed(new Set(ids.filter((v) => typeof v === 'string')));
    } catch {
      // A broken stored value leaves every folder open.
    }
  }, []);
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        // Storage full or blocked: the state still applies for this page.
      }
      return next;
    });
  }, []);
  return { collapsed, toggle };
}
