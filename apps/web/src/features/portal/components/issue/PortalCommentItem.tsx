'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import { formatDateTime } from '@/utils/dates';
import type { PortalComment } from '../../services/portal.service';
import PortalCommentBox from './PortalCommentBox';

// One comment. The visitor may edit or delete their own; team answers carry a "Team"
// badge. Bodies are Markdown, shown read-only as in the app's comments.
export default function PortalCommentItem({
  comment,
  onEdit,
  onDelete,
  busy,
}: {
  comment: PortalComment;
  onEdit: (body: string) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <article className="flex flex-col gap-1">
      <header className="flex items-center gap-2 text-sm">
        <span className="font-medium">{comment.author.name}</span>
        {comment.author.team && (
          <Badge variant="secondary" className="font-normal">
            Team
          </Badge>
        )}
        <time className="text-xs text-muted-foreground" dateTime={comment.createdAt}>
          {formatDateTime(comment.createdAt)}
          {comment.editedAt && ' · edited'}
        </time>
        {comment.mine && !editing && (
          <span className="ml-auto flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
              Delete
            </Button>
          </span>
        )}
      </header>
      {editing ? (
        <PortalCommentBox
          initial={comment.body}
          submitLabel="Save"
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={(body) => {
            onEdit(body);
            setEditing(false);
          }}
        />
      ) : (
        <MarkdownEditor
          key={comment.editedAt ?? comment.id}
          className="text-sm text-foreground/85"
          defaultValue={comment.body}
          editable={false}
        />
      )}
    </article>
  );
}
