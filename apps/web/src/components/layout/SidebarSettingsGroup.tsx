import { Settings2, type LucideIcon } from 'lucide-react';
import type { SettingsNavItem } from '@/utils/settingsNav';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

// One labelled group of the Settings sidebar (Account, Workspace). Nothing renders
// when the viewer may open none of its pages.
export default function SidebarSettingsGroup({
  label,
  items,
  icons,
}: {
  label: string;
  items: SettingsNavItem[];
  icons: Record<string, LucideIcon>;
}) {
  if (items.length === 0) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarNavItem
              key={item.key}
              href={item.href}
              icon={icons[item.key] ?? Settings2}
              label={item.label}
              active={item.active}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
