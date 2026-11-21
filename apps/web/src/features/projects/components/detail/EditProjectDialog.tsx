'use client';

import { useState } from 'react';
import type { Project } from '@/lib/api';
import { useUpdateProject } from '@/services/projects.service';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// Only title and description; the other fields are edited inline from the header pills.
export default function EditProjectDialog({
  project,
  teamKey,
  onClose,
}: {
  project: Project;
  teamKey: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(project.name);
  const [description, setDescription] = useState(project.content);
  const update = useUpdateProject(teamKey);

  const submit = async () => {
    const name = title.trim();
    if (!name) return;
    await update.mutateAsync({
      id: project.id,
      patch: { name, content: description.trim() },
    });
    onClose();
  };

  return (
    <Modal title="Edit project" teamKey={teamKey} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-project-title">Title</Label>
          <Input
            id="edit-project-title"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && title.trim() && void submit()}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-project-description">Description</Label>
          <Textarea
            id="edit-project-description"
            value={description}
            placeholder="What is this project about?"
            className="min-h-32"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || update.isPending} onClick={() => void submit()}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
