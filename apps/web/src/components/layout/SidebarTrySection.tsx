import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, Import, Plus } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useMinimumRole } from '@/hooks/useSecuritySettings';
import { tryItems } from '@/utils/sidebarModel';
import { workspaceImportPath } from '@/utils/paths';
import { meetsMinimumRole } from '@/utils/workspaceRoles';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import { InviteDialog } from '@/features/workspace/components/WorkspaceInviteDialog';

// The "Try" section at the bottom of the sidebar, as in Linear: Import issues (owners
// and admins) and Invite people (as the organization's invitationsRole allows). The
// section folds like a sidebar group and is hidden when neither item applies.
export default function SidebarTrySection() {
  const pathname = usePathname();
  const { workspaceRole } = usePermissions();
  const canInvite = meetsMinimumRole(workspaceRole, useMinimumRole('invitationsRole'));
  const items = tryItems({ role: workspaceRole, canInvite });
  const [open, setOpen] = useState(true);
  const [inviting, setInviting] = useState(false);

  if (items.length === 0 || !workspaceRole) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/try mt-auto">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="w-fit gap-1">
            Try
            <ChevronDown className="size-3 transition-transform group-data-[state=closed]/try:-rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.includes('import') && (
                <SidebarNavItem
                  href={workspaceImportPath()}
                  icon={Import}
                  label="Import issues"
                  active={pathname === workspaceImportPath()}
                />
              )}
              {items.includes('invite') && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Invite people" onClick={() => setInviting(true)}>
                    <Plus />
                    <span>Invite people</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
      {items.includes('invite') && (
        <InviteDialog viewerRole={workspaceRole} open={inviting} onOpenChange={setInviting} />
      )}
    </Collapsible>
  );
}
