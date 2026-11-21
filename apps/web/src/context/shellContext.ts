import { createContext, useContext } from 'react';
import type { CustomField, IssueOpenMode, TeamDetail, View } from '@/lib/api';
import type { NewIssueDefaults } from '@/utils/team';
import type { useViewEditor } from '@/hooks/useViewEditor';

// What the Shell layout provides to its child pages (the work items view and the
// settings pages) through React context. The Shell owns the team data, the
// view editor and the team-level overlays; children read them here instead of
// re-querying.
export type ShellContext = {
  team: TeamDetail | null;
  filteredTeam: TeamDetail | null;
  views: View[];
  editor: ReturnType<typeof useViewEditor>;
  customFields: CustomField[];
  // Opens an issue. Without `mode` the account's issueOpenMode preference decides
  // between the side panel and the issue page; pass it to force one of them.
  onOpenIssue: (id: string, mode?: IssueOpenMode) => void;
  onAddIssue: (defaults: NewIssueDefaults) => void;
};

export const ShellCtx = createContext<ShellContext | null>(null);

export function useShell(): ShellContext {
  const ctx = useContext(ShellCtx);
  if (!ctx) throw new Error('useShell must be used within the team Shell');
  return ctx;
}
