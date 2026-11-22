import { usePathname } from 'next/navigation';
import { Shield, type LucideIcon } from 'lucide-react';
import { rolesPath, settingsPath } from '@/utils/paths';
import {
  AUTOMATION_SECTIONS,
  CONFIGURATION_SECTIONS,
  GENERAL_SECTIONS,
  type SettingsSection,
} from '@/utils/settingsSections';
import { usePermissions } from '@/hooks/usePermissions';
import type { TeamDetail } from '@/lib/api';

// The team settings sidebar (the "Team settings" mode) lists the
// Configuration sections flat under group labels. This hook builds those groups
// from the section config and the viewer's permissions, and reports the first
// reachable destination so the main sidebar's "Team settings" entry knows
// where to point.

export type SettingsNavItem = {
  key: string;
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
};

export type SettingsNavGroup = {
  key: string;
  label: string;
  items: SettingsNavItem[];
};

// `team` is only passed by the Shell, which calls this above its own context
// provider; everything else reads the team from the context.
export function useSettingsNavGroups(
  teamKey: string | null,
  team?: TeamDetail | null,
): {
  groups: SettingsNavGroup[];
  firstHref: string | null;
} {
  const pathname = usePathname();
  const { can, isOwner } = usePermissions(team);

  // The readable sections of one group as nav items. `activeBase` is the path
  // segment the slug is appended to when matching the current route.
  const toItems = (
    sections: SettingsSection[],
    hrefFor: (key: string, slug: string) => string,
    activeBase: string,
  ): SettingsNavItem[] =>
    sections
      .filter((s) => can(s.resource, 'read'))
      .map((s) => ({
        key: s.slug,
        href: teamKey ? hrefFor(teamKey, s.slug) : '#',
        icon: s.icon,
        label: s.label,
        active: pathname.endsWith(`${activeBase}/${s.slug}`),
      }));

  const generalItems = toItems(GENERAL_SECTIONS, settingsPath, '/settings');
  const workflowItems = toItems(CONFIGURATION_SECTIONS, settingsPath, '/settings');
  const automationItems = toItems(AUTOMATION_SECTIONS, settingsPath, '/settings');

  // Roles is owner-only and sits in the Team group; Members lives in the main
  // sidebar, not here.
  const rolesItems: SettingsNavItem[] = isOwner
    ? [
        {
          key: 'roles',
          href: teamKey ? rolesPath(teamKey) : '#',
          icon: Shield,
          label: 'Roles',
          active: pathname.endsWith('/members/roles'),
        },
      ]
    : [];

  const groups: SettingsNavGroup[] = [
    { key: 'general', label: 'Team', items: [...generalItems, ...rolesItems] },
    { key: 'workflow', label: 'Workflow', items: workflowItems },
    { key: 'automation', label: 'Automation', items: automationItems },
  ].filter((g) => g.items.length > 0);

  const firstHref = groups[0]?.items[0]?.href ?? null;

  return { groups, firstHref };
}
