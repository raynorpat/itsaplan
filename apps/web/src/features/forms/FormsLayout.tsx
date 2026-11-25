import type { ReactNode } from 'react';

// The frame of a form's pages: a single column, without the app's shell.
export default function FormsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-background">
      <main className="mx-auto w-full max-w-xl px-4 pb-16 sm:px-6">{children}</main>
    </div>
  );
}
