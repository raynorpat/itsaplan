'use client';

import { useState } from 'react';
import type { ProjectDetail } from '@/services/projects.service';
import { useProjectMilestonesQuery } from '@/services/projects.service';
import { useCreateProjectRelation } from '@/services/projectRelations.service';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DependencyAnchorSelect, { type AnchorValue } from './DependencyAnchorSelect';
import DependencyProjectSelect from './DependencyProjectSelect';

type Direction = 'blockedBy' | 'blocking';

const END: AnchorValue = { anchorType: 'end', milestoneId: null };
const START: AnchorValue = { anchorType: 'start', milestoneId: null };

// Adds a dependency between this project and another: which side blocks, the other
// project, and where it attaches on each side. It starts as "the blocker's end
// blocks the other's start", the common case.
export default function AddDependencyDialog({
  project,
  teamKey,
  onClose,
}: {
  project: ProjectDetail;
  teamKey: string;
  onClose: () => void;
}) {
  const [direction, setDirection] = useState<Direction>('blockedBy');
  const [otherId, setOtherId] = useState<string | null>(null);
  const [thisAnchor, setThisAnchor] = useState<AnchorValue>(START);
  const [otherAnchor, setOtherAnchor] = useState<AnchorValue>(END);
  const otherMilestones = useProjectMilestonesQuery(otherId).data ?? [];
  const create = useCreateProjectRelation();

  const changeDirection = (next: Direction) => {
    setDirection(next);
    setThisAnchor(next === 'blockedBy' ? START : END);
    setOtherAnchor(next === 'blockedBy' ? END : START);
  };

  const submit = async () => {
    if (!otherId) return;
    const [blocking, blocked] =
      direction === 'blockedBy'
        ? [
            { id: otherId, anchor: otherAnchor },
            { id: project.id, anchor: thisAnchor },
          ]
        : [
            { id: project.id, anchor: thisAnchor },
            { id: otherId, anchor: otherAnchor },
          ];
    await create.mutateAsync({
      projectId: blocking.id,
      anchorType: blocking.anchor.anchorType,
      projectMilestoneId: blocking.anchor.milestoneId,
      relatedProjectId: blocked.id,
      relatedAnchorType: blocked.anchor.anchorType,
      relatedProjectMilestoneId: blocked.anchor.milestoneId,
    });
    onClose();
  };

  return (
    <Modal title="Add dependency" teamKey={teamKey} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dependency-direction">This project</Label>
          <Select value={direction} onValueChange={(v) => changeDirection(v as Direction)}>
            <SelectTrigger id="dependency-direction" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blockedBy">is blocked by</SelectItem>
              <SelectItem value="blocking">blocks</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DependencyProjectSelect
          projectId={project.id}
          value={otherId}
          onChange={(id) => {
            setOtherId(id);
            if (otherAnchor.anchorType === 'milestone')
              setOtherAnchor(direction === 'blockedBy' ? END : START);
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <DependencyAnchorSelect
            id="dependency-other-anchor"
            label={direction === 'blockedBy' ? 'Blocking at its' : 'Blocked at its'}
            value={otherAnchor}
            milestones={otherMilestones}
            onChange={setOtherAnchor}
          />
          <DependencyAnchorSelect
            id="dependency-this-anchor"
            label={
              direction === 'blockedBy' ? "Blocked at this project's" : "Blocking at this project's"
            }
            value={thisAnchor}
            milestones={project.milestones}
            onChange={setThisAnchor}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!otherId || create.isPending} onClick={() => void submit()}>
            Add dependency
          </Button>
        </div>
      </div>
    </Modal>
  );
}
