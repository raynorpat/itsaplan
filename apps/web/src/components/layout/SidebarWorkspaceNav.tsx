import { usePathname } from 'next/navigation';
import { Tags, Target } from 'lucide-react';
import { projectLabelsSettingsPath, projectsPath } from '@/utils/paths';
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

// The workspace-level group above the team navigation: Projects (across every
// team) and their labels.
export default function SidebarWorkspaceNav() {
  const pathname = usePathname();
  const labels = projectLabelsSettingsPath();
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
