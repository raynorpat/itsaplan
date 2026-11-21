import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { projectPath } from '@/utils/paths';
import { useCreateProject } from '@/services/projects.service';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// Creates an project from a title and optional description, then opens its
// detail page. The remaining fields (owner, priority, target date, labels) are
// set there.
export default function CreateProjectDialog({
  teamKey,
  onClose,
}: {
  teamKey: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const create = useCreateProject(teamKey);
  const router = useRouter();

  const submit = async () => {
    const name = title.trim();
    if (!name) return;
    const created = await create.mutateAsync({ name, content: description.trim() });
    onClose();
    router.push(projectPath(teamKey, created.id));
  };

  return (
    <Modal title="New project" teamKey={teamKey} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-title">Title</Label>
          <Input
            id="project-title"
            value={title}
            autoFocus
            placeholder="Q3 Launch"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && title.trim() && void submit()}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-description">Description</Label>
          <Textarea
            id="project-description"
            value={description}
            placeholder="What is this project about?"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || create.isPending} onClick={() => void submit()}>
            {create.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
