import { useEffect, useRef } from 'react';
import type { Team } from '@/types/team';
import type { WorkItemsView } from '@/utils/viewTypes';
import { isTypingTarget, type HotkeyId } from '@/utils/hotkeys';
import { useHotkeyMatch } from '@/context/useHotkeys';
import { goSequenceStep, type GoTarget } from '@/utils/goSequence';

// The layout hotkeys, paired with the view each one opens.
const VIEW_HOTKEYS: [HotkeyId, WorkItemsView][] = [
  ['view.kanban', 'kanban'],
  ['view.table', 'table'],
  ['view.timeline', 'timeline'],
  ['view.calendar', 'calendar'],
];

// The global keyboard layer. Which combination runs what is declared in
// lib/hotkeys; this hook only decides when a binding may fire. A 'global' binding
// (the palette, the team switch) fires even with an overlay open, while an
// 'app' one is suppressed while the user types or an overlay is open, because its
// combination is a plain key that would land in the text being typed.
export function useKeyboardShortcuts(opts: {
  hasTeam: boolean;
  teams: Team[];
  // True while any modal/overlay is open, which suppresses the app bindings.
  overlayOpen: boolean;
  onToggleCommand: () => void;
  onSelectTeam: (key: string) => void;
  onChangeView: (view: WorkItemsView) => void;
  onNewIssue: () => void;
  onNewTeam: () => void;
  // Cmd+, opens the Settings area; S opens the current team's settings.
  onSettings: () => void;
  onTeamSettings: () => void;
  // Linear's G-then-letter navigation (G I, G M, G P).
  onGo: (target: GoTarget) => void;
}) {
  const {
    hasTeam,
    teams,
    overlayOpen,
    onToggleCommand,
    onSelectTeam,
    onChangeView,
    onNewIssue,
    onNewTeam,
    onSettings,
    onTeamSettings,
    onGo,
  } = opts;
  // The time G was pressed, while a G sequence waits for its second key.
  const goPending = useRef<number | null>(null);
  const { matches, digit } = useHotkeyMatch();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (matches(e, 'palette.toggle')) {
        e.preventDefault();
        onToggleCommand();
        return;
      }
      // The team switch is positional: the digit picks the team at that
      // place in the list.
      const position = digit(e, 'team.switch');
      if (position != null) {
        const target = teams[position - 1];
        if (target) {
          e.preventDefault();
          onSelectTeam(target.key);
        }
        return;
      }

      if (matches(e, 'settings.open')) {
        e.preventDefault();
        onSettings();
        return;
      }

      if (isTypingTarget(e.target) || overlayOpen) {
        goPending.current = null;
        return;
      }

      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const step = goSequenceStep(goPending.current, e.key, Date.now());
        const waiting = goPending.current != null;
        goPending.current = step.pending;
        if (step.target) {
          e.preventDefault();
          onGo(step.target);
          return;
        }
        // The key after a G belongs to the sequence even when it matched nothing.
        if (waiting || step.pending != null) return;
      }

      if (hasTeam) {
        for (const [id, view] of VIEW_HOTKEYS) {
          if (matches(e, id)) {
            e.preventDefault();
            onChangeView(view);
            return;
          }
        }
      }
      if (hasTeam && matches(e, 'issue.new')) {
        e.preventDefault();
        onNewIssue();
        return;
      }
      if (matches(e, 'team.new')) {
        e.preventDefault();
        onNewTeam();
        return;
      }
      if (hasTeam && matches(e, 'team.settings')) {
        e.preventDefault();
        onTeamSettings();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    hasTeam,
    teams,
    overlayOpen,
    matches,
    digit,
    onToggleCommand,
    onSelectTeam,
    onChangeView,
    onNewIssue,
    onNewTeam,
    onSettings,
    onTeamSettings,
    onGo,
  ]);
}
