import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import GodShell from '@/components/layout/GodShell';

// God mode lives outside the team shell: its settings are instance-wide, so no
// team is loaded. The sidebar open/collapsed state uses the same `sidebar_state`
// cookie as the team layout, so the sidebar keeps its width across the two.
export default async function GodLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const defaultSidebarOpen = cookieStore.get('sidebar_state')?.value !== 'false';
  return <GodShell defaultSidebarOpen={defaultSidebarOpen}>{children}</GodShell>;
}
