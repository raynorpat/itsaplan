'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useTeamsQuery } from '@/services/teams.service';
import { newViewPath } from '@/utils/paths';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// New view on the workspace Views page: a view belongs to a team, so it asks which
// one first. Offered teams are the ones the viewer is in, where views can be made.
export default function WorkspaceNewViewMenu() {
  const teams = (useTeamsQuery().data ?? []).filter((t) => t.role != null);
  if (teams.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-3.5" /> New view
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>In team</DropdownMenuLabel>
        {teams.map((team) => (
          <DropdownMenuItem key={team.key} asChild>
            <Link href={newViewPath(team.key)}>{team.name}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
