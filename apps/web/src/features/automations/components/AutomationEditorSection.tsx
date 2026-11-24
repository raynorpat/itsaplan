import type { ReactNode } from 'react';

// One labelled part of the automation editor (Name, When, If, Then, Who can edit).
export default function AutomationEditorSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{label}</h2>
      {children}
    </section>
  );
}
