'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePortalSimilar, useSuggest } from '../../services/portal.service';
import PortalIssueRow from '../PortalIssueRow';

// A new request. While the title is typed, matching issues on the board are offered,
// so a vote can go to an existing issue instead of a duplicate.
export default function PortalSuggestDialog({
  slug,
  onClose,
}: {
  slug: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const similar = usePortalSimilar(slug, useDebouncedValue(title, 300));
  const suggest = useSuggest(slug);
  const matches = similar.data ?? [];

  return (
    <Modal title="Suggest a request" onClose={onClose} wide>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          suggest.mutate(
            { title: title.trim(), details: details.trim() },
            { onSuccess: ({ identifier }) => router.push(`/portal/${slug}/${identifier}`) },
          );
        }}
      >
        <Input
          aria-label="Title"
          placeholder="What would you like?"
          autoFocus
          maxLength={255}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {matches.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">
              Is it one of these? Vote for it instead.
            </p>
            <ul className="flex flex-col">
              {matches.map((issue) => (
                <PortalIssueRow key={issue.identifier} slug={slug} issue={issue} signedIn />
              ))}
            </ul>
          </div>
        )}
        <Textarea
          aria-label="Details"
          placeholder="Tell the team more: what you are trying to do, and why"
          rows={5}
          maxLength={10_000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={!title.trim() || suggest.isPending}>
            Submit
          </Button>
        </div>
      </form>
    </Modal>
  );
}
