'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { canSeeFeedback } from '@/utils/feedback';
import { useViewerWorkspaceQuery } from '@/services/viewer.service';
import { Input } from '@/components/ui/input';
import FeedbackNav from '@/components/common/page/FeedbackNav';
import PeopleList from './components/PeopleList';
import { usePeopleQuery } from './services/people.service';

// Feedback → People: everyone who gave feedback, searched by name or email. Guests see
// no feedback, so the page is not found for them.
export default function PeoplePage() {
  const viewer = useViewerWorkspaceQuery();
  const visible = canSeeFeedback(viewer.data?.workspaceRole ?? null);
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search, 250);
  const query = usePeopleQuery(term, visible);

  if (viewer.isPending) return null;
  if (!visible) return <p className="px-6 py-8 text-sm text-muted-foreground">Page not found.</p>;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <FeedbackNav />
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <h1 className="text-lg font-semibold">People</h1>
        <div className="relative w-64">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search people"
            placeholder="Search by name or email"
            className="h-8 pl-7"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {query.isPending ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
      ) : query.people.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {term.trim()
            ? 'No one matches this search.'
            : 'No feedback yet. People appear here once their feedback is added to an issue.'}
        </p>
      ) : (
        <PeopleList
          people={query.people}
          hasMore={!!query.hasNextPage}
          loadingMore={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
        />
      )}
    </div>
  );
}
