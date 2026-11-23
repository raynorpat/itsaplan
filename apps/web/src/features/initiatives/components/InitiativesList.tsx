'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/common/page/EmptyState';
import { type InitiativeSummary } from '../services/initiatives.service';
import InitiativeRow from './InitiativeRow';

// The initiatives table: name and status, health, owner, target date and the number
// of projects.
export default function InitiativesList({
  initiatives,
  teamKey,
  isLoading,
  onCreate,
}: {
  initiatives: InitiativeSummary[];
  teamKey: string;
  isLoading: boolean;
  onCreate: () => void;
}) {
  if (isLoading) return <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>;
  if (initiatives.length === 0)
    return (
      <EmptyState
        title="No initiatives"
        description="An initiative groups projects under one company goal."
      >
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-3.5" />
          New initiative
        </Button>
      </EmptyState>
    );

  return (
    <div className="px-4 pb-2">
      <Table className="min-w-[760px] table-fixed">
        <colgroup>
          <col className="w-[40%]" />
          <col className="w-[16%]" />
          <col className="w-[18%]" />
          <col className="w-[14%]" />
          <col className="w-[12%]" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Health</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Target date</TableHead>
            <TableHead>Projects</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {initiatives.map((i) => (
            <InitiativeRow key={i.id} initiative={i} teamKey={teamKey} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
