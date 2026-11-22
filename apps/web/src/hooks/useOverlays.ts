import { useState } from 'react';
import type { NewIssueDefaults } from '@/utils/team';

// The team-level overlays: the new-team modal, the command palette, the
// new-issue modal and the issue detail panel. Grouped here so the Shell tracks
// one object instead of four flags, and so the keyboard shortcut layer can ask
// whether any overlay is open through `anyOpen`. Team settings are their own
// pages, not an overlay.
export function useOverlays() {
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  // Initial field values for a new issue (null = the new-issue modal is closed).
  const [newIssueDefaults, setNewIssueDefaults] = useState<NewIssueDefaults | null>(null);
  // Which issue the detail panel shows (null = the panel is closed).
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const anyOpen = showNewTeam || showCommand || newIssueDefaults != null || openIssueId != null;

  return {
    showNewTeam,
    setShowNewTeam,
    showCommand,
    setShowCommand,
    newIssueDefaults,
    setNewIssueDefaults,
    openIssueId,
    setOpenIssueId,
    anyOpen,
  };
}
