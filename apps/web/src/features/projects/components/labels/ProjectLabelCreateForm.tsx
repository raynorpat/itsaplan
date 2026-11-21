'use client';

import { useState } from 'react';
import { useProjectLabelMutations } from '@/services/projects.service';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Adds a project label from a name and a color.
export default function ProjectLabelCreateForm() {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#4ea7fc');
  const { create } = useProjectLabelMutations();

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await create.mutateAsync({ name: trimmed, color });
    setName('');
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="Label color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="size-8 cursor-pointer rounded border bg-transparent"
      />
      <Input
        value={name}
        placeholder="New label"
        className="h-8 w-64"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />
      <Button size="sm" disabled={!name.trim() || create.isPending} onClick={() => void submit()}>
        Add label
      </Button>
    </div>
  );
}
