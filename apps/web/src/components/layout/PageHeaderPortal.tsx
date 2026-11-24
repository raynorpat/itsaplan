'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePageHeaderSlot } from '@/context/pageHeaderSlot';

// Renders a page's header controls into the page header line (see AppHeader).
export default function PageHeaderPortal({ children }: { children: ReactNode }) {
  const slot = usePageHeaderSlot();
  return slot ? createPortal(children, slot) : null;
}
