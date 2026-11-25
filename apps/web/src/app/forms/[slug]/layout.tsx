import type { ReactNode } from 'react';
import FormsLayout from '@/features/forms/FormsLayout';

// Form links: pages for people outside the workspace, without the app's shell.
export default function Layout({ children }: { children: ReactNode }) {
  return <FormsLayout>{children}</FormsLayout>;
}
