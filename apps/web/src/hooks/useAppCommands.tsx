import { LayoutGrid, ListChecks, Plus, SquarePlus } from 'lucide-react';
import type { Team } from '@/lib/api';
import { VIEWS, type WorkItemsView } from '@/utils/viewTypes';
import { usePermissions } from '@/hooks/usePermissions';
import { useHotkeyFormatter } from '@/context/useHotkeys';
import type { Command, CommandSection } from '@/utils/commands';

// The commands that are not tied to one issue: the work items board controls
// (shown only while the board is open) and the general team commands. The
// handlers come from the Shell, which owns the overlays and the router.
export function useAppCommands({
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
}: {
  hasTeam: boolean;
  // True on the work items routes, where the layout and selection commands apply.
  onBoard: boolean;
  view: WorkItemsView;
  teams: Team[];
  currentTeamKey: string | null;
  onViewChange: (view: WorkItemsView) => void;
  onNewIssue: () => void;
  onSelectAll: () => void;
  onNewTeam: () => void;
  onSelectTeam: (key: string) => void;
}): {
  board: CommandSection | null;
  general: CommandSection | null;
  teams: CommandSection | null;
} {
  const { can } = usePermissions();
  const hotkey = useHotkeyFormatter();

  const boardItems: Command[] = [];
  if (hasTeam && onBoard) {
    for (const { value, label, icon: Icon, hotkey: id } of VIEWS) {
      boardItems.push({
        id: `board.view.${value}`,
        label: `${label} layout`,
        icon: <Icon />,
        keywords: 'view layout switch',
        shortcut: hotkey(id) ?? undefined,
        checked: value === view,
        run: () => onViewChange(value),
      });
    }
    if (view === 'kanban') {
      boardItems.push({
        id: 'board.select-all',
        label: 'Select all issues',
        icon: <ListChecks />,
        keywords: 'selection multi',
        shortcut: hotkey('board.select-all') ?? undefined,
        run: onSelectAll,
      });
    }
  }

  const generalItems: Command[] = [];
  if (hasTeam && can('work_items', 'create')) {
    generalItems.push({
      id: 'general.new-issue',
      label: 'New issue',
      icon: <Plus />,
      keywords: 'create add task',
      shortcut: hotkey('issue.new') ?? undefined,
      run: onNewIssue,
    });
  }
  generalItems.push({
    id: 'general.new-team',
    label: 'New team',
    icon: <SquarePlus />,
    keywords: 'create add',
    shortcut: hotkey('team.new') ?? undefined,
    run: onNewTeam,
  });

  const teamItems: Command[] = teams.map((p, i) => ({
    id: `team.switch.${p.key}`,
    label: p.name,
    icon: <LayoutGrid />,
    keywords: `switch team ${p.key}`,
    checked: p.key === currentTeamKey,
    // The team switch is positional, so the digit is the row's place in the list.
    shortcut: (i < 9 ? hotkey('team.switch')?.replace('1–9', String(i + 1)) : null) ?? undefined,
    run: () => onSelectTeam(p.key),
  }));

  return {
    board: boardItems.length > 0 ? { id: 'board', heading: 'Board', items: boardItems } : null,
    general:
      generalItems.length > 0 ? { id: 'general', heading: 'Commands', items: generalItems } : null,
    teams: teamItems.length > 0 ? { id: 'teams', heading: 'Switch team', items: teamItems } : null,
  };
}
