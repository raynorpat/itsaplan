import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { settingsPath } from '@/utils/paths';
import {
  AUTOMATION_SECTIONS,
  CONFIGURATION_SECTIONS,
  GENERAL_SECTIONS,
  type SettingsSection,
} from '@/utils/settingsSections';
import { usePermissions } from '@/hooks/usePermissions';
import type { TeamDetail } from '@/types/team';

// A team's settings sections in the Settings area, grouped under labels. This hook
// builds those groups from the section config and the viewer's permissions, and
// reports the first reachable section, where the team's settings open.

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
  const { can } = usePermissions(team);

  // The readable sections of one group as nav items.
  const toItems = (sections: SettingsSection[]): SettingsNavItem[] =>
    sections
      .filter((s) => can(s.resource, 'read'))
      .map((s) => {
        const href = teamKey ? settingsPath(teamKey, s.slug) : '#';
        return { key: s.slug, href, icon: s.icon, label: s.label, active: pathname === href };
      });

  const generalItems = toItems(GENERAL_SECTIONS);
  const workflowItems = toItems(CONFIGURATION_SECTIONS);
  const automationItems = toItems(AUTOMATION_SECTIONS);

  const groups: SettingsNavGroup[] = [
    { key: 'general', label: 'Team', items: generalItems },
    { key: 'workflow', label: 'Workflow', items: workflowItems },
    { key: 'automation', label: 'Automation', items: automationItems },
  ].filter((g) => g.items.length > 0);

  const firstHref = groups[0]?.items[0]?.href ?? null;

  return { groups, firstHref };
}
