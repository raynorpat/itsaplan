'use client';

import GodSearchInput from '../GodSearchInput';

// Search above the directory. It drives a server-side query, so a change here
// refetches a page rather than filtering what is on screen.
export default function GodUsersToolbar({
  search,
  onSearchChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <GodSearchInput
        value={search}
        onChange={onSearchChange}
        placeholder="Search by name or email"
        className="min-w-[240px] flex-1"
      />
    </div>
  );
}
