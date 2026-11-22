import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { projectPath } from '@/utils/paths';
import { useCreateProject } from '@/services/projects.service';
import { useTeamsQuery } from '@/services/teams.service';
import ProjectTeamsChecklist from '../shared/ProjectTeamsChecklist';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// Creates a project from a name, its teams (the current team preselected) and an
// optional description, then opens its page. The remaining fields (lead,
// priority, target date, labels) are set there.
export default function CreateProjectDialog({
  teamKey,
  onClose,
}: {
  teamKey: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const teams = useTeamsQuery().data ?? [];
  const current = teams.find((t) => t.key === teamKey);
  const [teamIds, setTeamIds] = useState<string[] | null>(null);
  const chosen = teamIds ?? (current ? [current.id] : []);
  const create = useCreateProject();
  const router = useRouter();

  const submit = async () => {
    const name = title.trim();
    if (!name) return;
    if (!name || chosen.length === 0) return;
    const created = await create.mutateAsync({
      name,
      content: description.trim(),
      teamIds: chosen,
    });
    onClose();
    router.push(projectPath(teamKey, created.id));
  };

  return (
    <Modal title="New project" teamKey={teamKey} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-title">Name</Label>
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
          <Label>Teams</Label>
          <ProjectTeamsChecklist teams={teams} value={chosen} onChange={setTeamIds} />
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
          <Button
            disabled={!title.trim() || chosen.length === 0 || create.isPending}
            onClick={() => void submit()}
          >
            {create.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
