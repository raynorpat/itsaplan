'use client';

import { useProjectsQuery } from '@/services/projects.service';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// The other project of a new dependency: any project the viewer can see except this one.
export default function DependencyProjectSelect({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: string | null;
  onChange: (projectId: string) => void;
}) {
  const projects = (useProjectsQuery('', { pageSize: 250 }).data?.items ?? []).filter(
    (p) => p.id !== projectId,
  );
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="dependency-project">Project</Label>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger id="dependency-project" className="w-full">
          <SelectValue placeholder="Pick a project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
