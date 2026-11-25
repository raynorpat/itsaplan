import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import Shell from '@/components/layout/Shell';

// The workspace-level dashboards render inside the same Shell as the team pages.
export default async function DashboardsLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const defaultSidebarOpen = cookieStore.get('sidebar_state')?.value !== 'false';
  return <Shell defaultSidebarOpen={defaultSidebarOpen}>{children}</Shell>;
}
