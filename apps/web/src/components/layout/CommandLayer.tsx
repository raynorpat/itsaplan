import type { Team } from '@/lib/api';
import type { WorkItemsView } from '@/utils/viewTypes';
import type { CommandSection } from '@/utils/commands';
import { useShell } from '@/context/shellContext';
import { useAppCommands } from '@/hooks/useAppCommands';
import { useNavigationCommands } from '@/hooks/useNavigationCommands';
import { useIssueCommands } from '@/features/issue/hooks/useIssueCommands';
import CommandPalette from '@/components/layout/CommandPalette';

// Builds the palette's sections and renders it. It sits inside the Shell's
// context provider (the command hooks read the team and the viewer's
// permissions from it), and owns the confirm dialogs the issue commands open —
// the palette closes when a command runs, so those must outlive it.
//
// Section order: the issue in front of the user first, then the board it came
// from, then the commands and destinations that apply anywhere.
export default function CommandLayer({
  open,
  onOpenChange,
  teams,
  currentTeamKey,
  onBoard,
  view,
  currentIssueId,
  onViewChange,
  onNewIssue,
  onSelectAll,
  onNewTeam,
  onSelectTeam,
  onOpenIssue,
  onIssueDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: Team[];
  currentTeamKey: string | null;
  onBoard: boolean;
  view: WorkItemsView;
  // The issue the user is looking at: the open detail panel, or the issue page.
  currentIssueId: string | null;
  onViewChange: (view: WorkItemsView) => void;
  onNewIssue: () => void;
  onSelectAll: () => void;
  onNewTeam: () => void;
  onSelectTeam: (key: string) => void;
  onOpenIssue: (sequenceNumber: number) => void;
  onIssueDeleted: () => void;
}) {
  const { team } = useShell();
  const hasTeam = !!team;

  const issue = useIssueCommands(team, currentIssueId, onIssueDeleted);
  const app = useAppCommands({
    hasTeam,
    onBoard,
    view,
    teams,
    currentTeamKey,
    onViewChange,
    onNewIssue,
    onSelectAll,
    onNewTeam,
    onSelectTeam,
  });
  const navigation = useNavigationCommands(currentTeamKey);

  // Empty sections are dropped here so each hook can return one unconditionally.
  const sections = [issue.section, app.board, app.general, app.teams, navigation].filter(
    (s): s is CommandSection => s != null && s.items.length > 0,
  );

  return (
    <>
      <CommandPalette
        open={open}
        onOpenChange={onOpenChange}
        sections={sections}
        currentTeamKey={currentTeamKey}
        hasTeam={hasTeam}
        onOpenIssue={onOpenIssue}
      />
      {issue.dialogs}
    </>
  );
}
