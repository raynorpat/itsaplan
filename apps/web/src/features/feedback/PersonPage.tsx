'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Merge, Pencil } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import { Button } from '@/components/ui/button';
import { useViewerWorkspaceQuery } from '@/services/viewer.service';
import { canSeeFeedback } from '@/utils/feedback';
import { feedbackPeoplePath, feedbackPersonPath } from '@/utils/paths';
import EditPersonDialog from './components/EditPersonDialog';
import MergePeopleDialog from './components/MergePeopleDialog';
import PersonCustomerField from './components/PersonCustomerField';
import PersonFeedback from './components/PersonFeedback';
import PersonPortalBlockButton from './components/PersonPortalBlockButton';
import PersonUpdatesSwitch from './components/PersonUpdatesSwitch';
import { usePersonQuery } from './services/people.service';
import { canMergePeople, feedbackCountText } from './utils/people';

// One person who gave feedback: their name and email, edit, their customer and "Keep
// this person updated" (members), merge into another person and block them from the portal
// (owners and admins), and their feedback grouped by issue. A merged
// person's id leads to the person kept (the API follows the merge).
export default function PersonPage() {
  const params = useParams();
  const id = typeof params.personId === 'string' ? params.personId : '';
  const router = useRouter();
  const viewer = useViewerWorkspaceQuery();
  const role = viewer.data?.workspaceRole ?? null;
  const visible = canSeeFeedback(role);
  const query = usePersonQuery(id, visible && id !== '');
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);

  if (viewer.isPending) return null;
  if (!visible || query.isError)
    return <p className="px-6 py-8 text-sm text-muted-foreground">Person not found.</p>;
  if (!query.data) return <p className="px-6 py-8 text-sm text-muted-foreground">Loading…</p>;

  const { person, issues } = query.data;
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="px-4 pt-3">
        <Link
          href={feedbackPeoplePath()}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          People
        </Link>
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar name={person.name} image={person.avatarUrl} className="size-9 text-sm" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{person.name}</h1>
          <p className="truncate text-sm text-muted-foreground">
            {[
              person.email,
              feedbackCountText(person.feedbackCount),
              person.portalBlocked && 'Blocked from the portal',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-3.5" />
          Edit
        </Button>
        {canMergePeople(role) && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setMerging(true)}
          >
            <Merge className="size-3.5" />
            Merge into…
          </Button>
        )}
        {canMergePeople(role) && <PersonPortalBlockButton person={person} />}
      </div>
      <PersonCustomerField person={person} />
      <PersonUpdatesSwitch person={person} />
      <h2 className="px-4 pt-2 pb-1 text-sm font-medium">Feedback</h2>
      <PersonFeedback groups={issues} />
      {editing && <EditPersonDialog person={person} onClose={() => setEditing(false)} />}
      {merging && (
        <MergePeopleDialog
          person={person}
          onClose={() => setMerging(false)}
          onMerged={(keptId) => {
            setMerging(false);
            router.replace(feedbackPersonPath(keptId));
          }}
        />
      )}
    </div>
  );
}
