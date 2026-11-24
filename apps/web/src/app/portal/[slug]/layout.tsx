import type { ReactNode } from 'react';
import PortalLayout from '@/features/portal/PortalLayout';

// Portal boards: pages for people outside the workspace, without the app's shell.
export default function Layout({ children }: { children: ReactNode }) {
  return <PortalLayout>{children}</PortalLayout>;
}
