import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import Shell from '@/components/layout/Shell';

// The workspace-level Projects area renders inside the same Shell as the team
// pages (sidebar, header, overlays); the Shell resolves its team from ?team= or
// the last team the user had open.
export default async function ProjectsLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const defaultSidebarOpen = cookieStore.get('sidebar_state')?.value !== 'false';
  return <Shell defaultSidebarOpen={defaultSidebarOpen}>{children}</Shell>;
}
