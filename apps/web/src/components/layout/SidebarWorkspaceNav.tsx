import { usePathname } from 'next/navigation';
import { Milestone, Tags, Target } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { initiativesPath, projectLabelsSettingsPath, projectsPath } from '@/utils/paths';
import { canSeeInitiatives } from '@/utils/workspaceRoles';
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

// The workspace-level group above the team navigation: Projects (across every
// team), Initiatives (hidden from guests, who have none) and the project labels.
export default function SidebarWorkspaceNav() {
  const pathname = usePathname();
  const labels = projectLabelsSettingsPath();
  const { workspaceRole } = usePermissions();
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarNavItem
            href={projectsPath()}
            icon={Target}
            label="Projects"
            active={pathname.startsWith('/projects') && !pathname.startsWith(labels)}
            disabled={false}
          />
          {canSeeInitiatives(workspaceRole) && (
            <SidebarNavItem
              href={initiativesPath()}
              icon={Milestone}
              label="Initiatives"
              active={pathname.startsWith('/initiatives')}
              disabled={false}
            />
          )}
          <SidebarNavItem
            href={labels}
            icon={Tags}
            label="Project labels"
            active={pathname.startsWith(labels)}
            disabled={false}
          />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
