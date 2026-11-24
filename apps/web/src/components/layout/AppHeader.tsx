import type { ReactNode } from 'react';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

// The page header inside the sidebar inset, one line as in Linear: the sidebar
// toggle, the page's breadcrumb, then the slot where a page renders its own header
// controls (view tabs, filter, display; see PageHeaderPortal). Search, new issue,
// theme and the account live in the sidebar's workspace menu.
export default function AppHeader({
  title,
  slotRef,
}: {
  title: ReactNode;
  slotRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-2 sm:px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <div className="max-w-[40%] min-w-0 shrink-0 truncate text-sm font-medium">{title}</div>
      <div ref={slotRef} className="flex min-w-0 flex-1 items-center" />
    </header>
  );
}
