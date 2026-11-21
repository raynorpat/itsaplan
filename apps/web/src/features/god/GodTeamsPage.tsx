'use client';

import { useState } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import GodSearchInput from './components/GodSearchInput';
import GodSectionPage from './components/GodSectionPage';
import GodPager, { PAGE_SIZES } from './components/GodPager';
import GodTeamDetailPanel from './components/teams/GodTeamDetailPanel';
import GodTeamsTable from './components/teams/GodTeamsTable';
import { useInstanceTeamsQuery } from './services/god.service';
import { withOffsetReset } from './utils/paging';

// The instance team directory: one row per team with what it holds, and a side
// panel showing every member and the permissions their membership resolves to. Like
// the user directory, search and paging run on the server, so the list never holds
// every team.
export default function GodTeamsPage() {
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState<number>(PAGE_SIZES[1]);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  // Typing refetches, so wait for a pause instead of firing per keystroke.
  const debouncedSearch = useDebouncedValue(search, 300);

  const teamsQuery = useInstanceTeamsQuery({ search: debouncedSearch, limit, offset });
  const teams = teamsQuery.data?.items ?? [];
  const total = teamsQuery.data?.total ?? 0;

  return (
    <GodSectionPage slug="teams" widthClassName="max-w-none">
      <div className="space-y-4">
        <GodSearchInput
          value={search}
          onChange={withOffsetReset(setOffset, setSearch)}
          placeholder="Search by key or name"
          className="max-w-md min-w-[240px]"
        />

        {teamsQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">No teams match this search.</p>
        ) : (
          <>
            <GodTeamsTable teams={teams} onSelect={setSelected} />
            <GodPager
              offset={offset}
              limit={limit}
              total={total}
              onOffsetChange={setOffset}
              onLimitChange={withOffsetReset(setOffset, setLimit)}
            />
          </>
        )}
      </div>

      {selected !== null && (
        <GodTeamDetailPanel teamId={selected} onClose={() => setSelected(null)} />
      )}
    </GodSectionPage>
  );
}
