import type { ReactNode } from 'react';

// One labelled row of a settings section, with its control on the right.
export default function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
      <div className="flex flex-1 flex-col">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
