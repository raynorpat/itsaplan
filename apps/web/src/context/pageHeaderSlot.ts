import { createContext, useContext } from 'react';

// The element in the page header (AppHeader) where a page renders its own header
// controls: view tabs, filter and display, on the same line as the breadcrumb, as
// in Linear. Null until the header has mounted, or outside the Shell.
export const PageHeaderSlotCtx = createContext<HTMLElement | null>(null);

export function usePageHeaderSlot(): HTMLElement | null {
  return useContext(PageHeaderSlotCtx);
}
