import { ArrowLeft } from 'lucide-react';
import { teamPath } from '@/utils/paths';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

// The team settings sidebar body: a "Back to team" link, then the
// Configuration groups (AI Team, Workflow) as flat lists under their labels —
// every item reachable directly, no collapsing.
export default function SidebarSettingsNav({ teamKey }: { teamKey: string | null }) {
  const disabled = !teamKey;
  const { groups } = useSettingsNavGroups(teamKey);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarNavItem
              href={teamKey ? teamPath(teamKey) : '#'}
              icon={ArrowLeft}
              label="Back to team"
              active={false}
              disabled={disabled}
            />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {groups.map((group) => (
        <SidebarGroup key={group.key}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarNavItem
                  key={item.key}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  active={item.active}
                  disabled={disabled}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
