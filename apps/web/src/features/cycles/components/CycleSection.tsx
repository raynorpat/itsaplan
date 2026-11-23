import type { ReactNode } from 'react';

// A titled group of cycles on the cycles page.
export default function CycleSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className="border-b bg-muted/30 px-6 py-2 text-xs font-medium text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}
