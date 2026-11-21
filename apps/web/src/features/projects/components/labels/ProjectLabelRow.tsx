'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { ProjectLabel } from '@/lib/api';
import { useProjectLabelMutations } from '@/services/projects.service';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// One project label: rename on blur or Enter, recolor, delete.
export default function ProjectLabelRow({ label }: { label: ProjectLabel }) {
  const [name, setName] = useState(label.name);
  const { update, remove } = useProjectLabelMutations();

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== label.name)
      update.mutate({ id: label.id, patch: { name: trimmed } });
    else setName(label.name);
  };

  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <input
        type="color"
        aria-label={`Color of ${label.name}`}
        value={label.color.toLowerCase()}
        onChange={(e) => update.mutate({ id: label.id, patch: { color: e.target.value } })}
        className="size-6 cursor-pointer rounded border bg-transparent"
      />
      <Input
        value={name}
        className="h-7 flex-1"
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => e.key === 'Enter' && saveName()}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete ${label.name}`}
        onClick={() => remove.mutate(label.id)}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}
