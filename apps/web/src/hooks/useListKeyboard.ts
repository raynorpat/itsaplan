'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useHotkeyCombos } from '@/context/useHotkeys';
import { listKeyAction, moveFocus } from '@/utils/list';
import { readListFocus, rememberListFocus, subscribeListFocus } from '@/utils/listFocus';

// The list's keyboard, as in Linear: J / K move the focused row, X selects it, Enter
// opens it, Space peeks it (the focused row, else the row under the pointer, read from
// `hoveredRef`) and Escape clears the focus. The focus is kept per page (the list's path),
// so it is still there after opening an issue as a page or in the panel and coming
// back. `order` is the visible rows top to bottom; a focused row that leaves it
// (collapsed, filtered out) drops the focus. `onFocusMove` brings a row into view.
export function useListKeyboard({
  order,
  onOpen,
  onSelect,
  onPeek,
  hoveredRef,
  onFocusMove,
}: {
  order: string[];
  onOpen: (id: string) => void;
  onSelect?: (id: string) => void;
  onPeek?: (id: string) => void;
  hoveredRef?: { current: string | null };
  onFocusMove?: (id: string) => void;
}) {
  const listKey = usePathname();
  const combos = useHotkeyCombos();
  const [raw, setRaw] = useState<string | null>(null);
  // True while this list writes its own focus, so its focus listener below skips
  // the echo instead of scrolling to the row a second time.
  const ownWrite = useRef(false);

  const setFocused = useCallback(
    (id: string | null) => {
      setRaw(id);
      ownWrite.current = true;
      rememberListFocus(listKey, id);
      ownWrite.current = false;
    },
    [listKey],
  );

  const latest = useRef({ order, focused: raw, onOpen, onSelect, onPeek, onFocusMove, setFocused });
  latest.current = { order, focused: raw, onOpen, onSelect, onPeek, onFocusMove, setFocused };

  // Restored after mount, not in the state initializer: the server render has no
  // focused row, and a client-only first value would not match its markup.
  useEffect(() => {
    const restored = readListFocus(listKey);
    setRaw(restored);
    if (restored != null) latest.current.onFocusMove?.(restored);
  }, [listKey]);

  // The peek panel moves this list's focus with J / K; the highlighted row follows.
  useEffect(
    () =>
      subscribeListFocus((key, id) => {
        if (ownWrite.current || key !== listKey || id === latest.current.focused) return;
        setRaw(id);
        if (id != null) latest.current.onFocusMove?.(id);
      }),
    [listKey],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = listKeyAction(e, combos);
      if (action == null) return;
      const k = latest.current;
      if (action === 'clear') {
        // Decided once the key press has reached every listener: a panel, dialog or
        // popover that closed on this Escape marks it handled, and the focus stays.
        setTimeout(() => {
          if (!e.defaultPrevented) k.setFocused(null);
        }, 0);
        return;
      }
      if (action === 'next' || action === 'prev') {
        e.preventDefault();
        const next = moveFocus(k.order, k.focused, action === 'next' ? 1 : -1);
        k.setFocused(next);
        if (next != null) k.onFocusMove?.(next);
        return;
      }
      if (action === 'peek') {
        const id = k.focused ?? hoveredRef?.current ?? null;
        if (!k.onPeek || id == null || !k.order.includes(id)) return;
        e.preventDefault();
        k.setFocused(id);
        k.onPeek(id);
        return;
      }
      if (k.focused == null || !k.order.includes(k.focused)) return;
      if (action === 'select') {
        if (!k.onSelect) return;
        e.preventDefault();
        k.onSelect(k.focused);
        return;
      }
      e.preventDefault();
      k.onOpen(k.focused);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combos, hoveredRef]);

  const focused = raw != null && order.includes(raw) ? raw : null;
  return { focused, setFocused };
}
