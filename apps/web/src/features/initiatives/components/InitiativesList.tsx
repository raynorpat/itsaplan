'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/common/page/EmptyState';
import { type InitiativeSummary } from '../services/initiatives.service';
import { firstDirection, sortInitiatives, type InitiativeSortKey } from '../utils/sortInitiatives';
import InitiativeRow from './InitiativeRow';
import InitiativeSortHead from './InitiativeSortHead';

const COLUMNS: { label: string; key: InitiativeSortKey }[] = [
  { label: 'Name', key: 'name' },
  { label: 'Health', key: 'health' },
  { label: 'Owner', key: 'owner' },
  { label: 'Target date', key: 'targetDate' },
  { label: 'Projects', key: 'projects' },
];

// The initiatives table: name and status, health, owner, target date and the number
// of projects. Every column sorts in the browser; a second click reverses it.
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
  const [sort, setSort] = useState<InitiativeSortKey | undefined>(undefined);
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const onSort = (key: InitiativeSortKey) => {
    if (key === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setDir(firstDirection(key));
    }
  };

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
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((col) => (
              <InitiativeSortHead
                key={col.key}
                label={col.label}
                column={col.key}
                sort={sort}
                dir={dir}
                onSort={onSort}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortInitiatives(initiatives, sort, dir).map((i) => (
            <InitiativeRow key={i.id} initiative={i} teamKey={teamKey} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
