import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { BoardDto } from '../services/portalAdmin.service';
import { portalUrl } from '../utils/board';

// One board in the list: name, address, access and how many issues it shows, with
// Copy link and Edit.
export default function PortalBoardRow({ board, onEdit }: { board: BoardDto; onEdit: () => void }) {
  const url = portalUrl(board.slug);
  const facts = [
    board.access === 'public' ? 'Public' : 'Restricted',
    board.issueCount === 1 ? '1 issue' : `${board.issueCount} issues`,
    ...(board.enabled ? [] : ['Disabled']),
  ];
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{board.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          <a href={url} target="_blank" rel="noreferrer" className="hover:underline">
            /portal/{board.slug}
          </a>{' '}
          · {facts.join(' · ')}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void navigator.clipboard.writeText(url).then(() => toast.success('Link copied'))
          }
        >
          Copy link
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}
