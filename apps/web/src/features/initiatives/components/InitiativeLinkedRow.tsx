'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import type { ProjectHealth } from '@/types/project';
import { colorDot } from '@/components/common/fields/colorDot';
import HealthBadge from '@/components/common/updates/HealthBadge';

// A linked project or sub-initiative: status, name (a link), health and a remove
// button.
export default function InitiativeLinkedRow({
  href,
  name,
  statusColor,
  statusLabel,
  health,
  removeLabel,
  onRemove,
}: {
  href: string;
  name: string;
  statusColor: string;
  statusLabel: string;
  health: ProjectHealth | null;
  removeLabel: string;
  onRemove?: () => void;
}) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      <span className="shrink-0" title={statusLabel}>
        {colorDot(statusColor)}
      </span>
      <Link href={href} className="min-w-0 flex-1 truncate text-sm hover:underline">
        {name}
      </Link>
      <HealthBadge health={health} />
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );
}
