import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import Shell from '@/components/layout/Shell';

// The Settings area renders inside the app Shell; on /settings the sidebar shows the
// settings navigation (Account, Workspace, Teams) instead of the main one.
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const defaultSidebarOpen = cookieStore.get('sidebar_state')?.value !== 'false';
  return <Shell defaultSidebarOpen={defaultSidebarOpen}>{children}</Shell>;
}
