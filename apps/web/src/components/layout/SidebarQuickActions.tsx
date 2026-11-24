import { Search, SquarePen } from 'lucide-react';
import { useHotkeyLabel } from '@/context/useHotkeys';
import { Button } from '@/components/ui/button';

// The search and new-issue buttons beside the workspace menu, as in Linear's
// sidebar. Search opens the command menu.
export default function SidebarQuickActions({
  onOpenCommand,
  onNewIssue,
  canCreateIssue,
}: {
  onOpenCommand: () => void;
  onNewIssue: () => void;
  canCreateIssue: boolean;
}) {
  const paletteKey = useHotkeyLabel('palette.toggle');
  const newIssueKey = useHotkeyLabel('issue.new');
  return (
    <div className="flex shrink-0 items-center gap-0.5 group-data-[collapsible=icon]:hidden">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={`Search (${paletteKey})`}
        aria-label="Search"
        onClick={onOpenCommand}
      >
        <Search />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={`New issue (${newIssueKey})`}
        aria-label="New issue"
        disabled={!canCreateIssue}
        onClick={onNewIssue}
      >
        <SquarePen />
      </Button>
    </div>
  );
}
