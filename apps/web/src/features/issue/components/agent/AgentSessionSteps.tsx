'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionActivity } from '../../utils/agentSession';

// A run of the agent's thoughts and actions, collapsed to the latest one (Linear).
// Expanding lists every step, oldest first.
function stepText(a: SessionActivity): string {
  if (a.type === 'action') {
    const head = [a.action, a.parameter].filter(Boolean).join(' ');
    return a.result ? `${head} — ${a.result}` : head;
  }
  return a.body ?? '';
}

export default function AgentSessionSteps({ activities }: { activities: SessionActivity[] }) {
  const [open, setOpen] = useState(false);
  const latest = activities.at(-1);
  if (!latest) return null;
  return (
    <li className="text-sm text-muted-foreground">
      <button
        type="button"
        className="flex w-full items-start gap-1.5 text-left hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          className={cn('mt-0.5 size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="min-w-0 flex-1 truncate">
          {open
            ? `${activities.length} ${activities.length === 1 ? 'step' : 'steps'}`
            : stepText(latest)}
        </span>
      </button>
      {open && (
        <ol className="mt-1 ml-5 flex flex-col gap-1">
          {activities.map((a) => (
            <li key={a.id} className="break-words whitespace-pre-wrap">
              {stepText(a)}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
