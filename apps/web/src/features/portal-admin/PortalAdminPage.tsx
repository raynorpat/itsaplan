'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsCard from '@/components/common/page/SettingsCard';
import { Button } from '@/components/ui/button';
import { usePortalBoardsQuery, type BoardDto } from './services/portalAdmin.service';
import PortalBoardRow from './components/PortalBoardRow';
import PortalBoardDialog from './components/PortalBoardDialog';

// Settings → Workspace → Portal (/settings/workspace/portal): owners and admins
// create the boards people outside the workspace see at /portal/<address>.
export default function PortalAdminPage() {
  const { data: session, isPending } = useSession();
  const isAdmin = isWorkspaceAdmin(toWorkspaceRole(session?.user.workspaceRole));
  const boards = usePortalBoardsQuery(isAdmin);
  // undefined: closed; null: a new board.
  const [editing, setEditing] = useState<BoardDto | null | undefined>(undefined);

  return (
    <SectionPageView
      title="Portal"
      description="Boards where people outside the workspace see issues, vote, comment and suggest requests. Their votes and suggestions arrive as feedback."
    >
      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isPending && !isAdmin && (
        <p className="text-sm text-muted-foreground">
          Only workspace owners and admins can manage portal boards.
        </p>
      )}
      {isAdmin && (
        <div className="flex flex-col gap-4">
          <div>
            <Button size="sm" onClick={() => setEditing(null)}>
              New board
            </Button>
          </div>
          {boards.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {boards.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No boards yet.</p>
          )}
          {boards.data && boards.data.length > 0 && (
            <SettingsCard className="divide-y divide-border/60">
              {boards.data.map((b) => (
                <PortalBoardRow key={b.id} board={b} onEdit={() => setEditing(b)} />
              ))}
            </SettingsCard>
          )}
        </div>
      )}
      {editing !== undefined && (
        <PortalBoardDialog board={editing} onClose={() => setEditing(undefined)} />
      )}
    </SectionPageView>
  );
}
