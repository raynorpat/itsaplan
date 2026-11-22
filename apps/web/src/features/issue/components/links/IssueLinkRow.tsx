import { useState } from 'react';
import { Globe, Pencil, Trash2 } from 'lucide-react';
import {
  Attachment as AttachmentCard,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment';
import { Input } from '@/components/ui/input';
import { type LinkAttachment } from '../../services/attachments.service';

// One link on the issue: its title (renamed in place), subtitle or host, and
// delete. The title opens the URL in a new tab.
export default function IssueLinkRow({
  link,
  canEdit,
  onRename,
  onDelete,
}: {
  link: LinkAttachment;
  canEdit: boolean;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  let host = link.url;
  try {
    host = new URL(link.url).host;
  } catch {
    // Keep the raw URL when it does not parse.
  }

  return (
    <AttachmentCard className="w-full">
      <AttachmentMedia variant="icon">
        <Globe className="text-muted-foreground" />
      </AttachmentMedia>
      <AttachmentContent>
        {editing ? (
          <Input
            autoFocus
            defaultValue={link.title}
            aria-label="Link title"
            className="h-7"
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next && next !== link.title) onRename(next);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <AttachmentTitle>
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:underline"
            >
              {link.title}
            </a>
          </AttachmentTitle>
        )}
        <AttachmentDescription>{link.subtitle ?? host}</AttachmentDescription>
      </AttachmentContent>
      {canEdit && !editing && (
        <AttachmentActions>
          <AttachmentAction
            onClick={() => setEditing(true)}
            aria-label={`Rename ${link.title}`}
            title="Rename"
          >
            <Pencil />
          </AttachmentAction>
          <AttachmentAction
            className="hover:text-destructive"
            onClick={onDelete}
            aria-label={`Delete ${link.title}`}
            title="Delete"
          >
            <Trash2 />
          </AttachmentAction>
        </AttachmentActions>
      )}
    </AttachmentCard>
  );
}
