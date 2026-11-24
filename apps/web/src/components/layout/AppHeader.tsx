import type { ReactNode } from 'react';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

// The page header inside the sidebar inset: the sidebar toggle and the page's
// breadcrumb. Search, new issue, theme and the account live in the sidebar's
// workspace menu, as in Linear; view tabs, filter and display sit below in the page.
export default function AppHeader({ title }: { title: ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-2 sm:px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <div className="min-w-0 truncate text-sm font-medium">{title}</div>
    </header>
  );
}
