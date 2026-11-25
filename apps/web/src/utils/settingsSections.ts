import {
  Archive,
  Columns3,
  Info,
  type LucideIcon,
  RefreshCcw,
  Rocket,
  Tags,
  Webhook,
  Workflow,
} from 'lucide-react';
import type { AccessArea } from '@/hooks/usePermissions';

// The sidebar group a section is listed under: the team-level general settings,
// workflow configuration, or automation.
export type SettingsGroup = 'general' | 'configuration' | 'automation';

// The team settings sections, each mounted as its own page at
// /settings/teams/:teamKey/:section. The slug is the route param; the tab
// components live in features/settings/components and take { team }. `resource`
// is the permission resource that gates the section: read to view it, and the
// create/edit/delete actions gate the controls inside. `group` places it in the
// sidebar (see CONFIGURATION_SECTIONS / AUTOMATION_SECTIONS).
export type SettingsSection = {
  slug: string;
  label: string;
  description: string;
  icon: LucideIcon;
  resource: AccessArea;
  group: SettingsGroup;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    slug: 'general',
    label: 'General',
    description: "The team's name, description, and the sections it shows.",
    icon: Info,
    resource: 'danger_zone',
    group: 'general',
  },
  {
    slug: 'states',
    label: 'States',
    description: 'The workflow states issues move through, each shown as a column.',
    icon: Columns3,
    resource: 'states',
    group: 'configuration',
  },
  {
    slug: 'labels',
    label: 'Labels',
    description: 'Tags for organizing and filtering issues across the team.',
    icon: Tags,
    resource: 'labels',
    group: 'configuration',
  },
  {
    slug: 'cycles',
    label: 'Cycles',
    description: "Repeating, time-boxed cycles to plan the team's work in.",
    icon: RefreshCcw,
    resource: 'work_items',
    group: 'configuration',
  },
  {
    slug: 'releases',
    label: 'Releases',
    description: 'Release pipelines, their stages, and the access keys CI uses to sync releases.',
    icon: Rocket,
    resource: 'work_items',
    group: 'configuration',
  },
  {
    slug: 'archive',
    label: 'Archive',
    description: 'Auto-archive stale completed and canceled issues so the board stays clear.',
    icon: Archive,
    resource: 'work_items',
    group: 'configuration',
  },
  {
    slug: 'automations',
    label: 'Automations',
    description: 'Rules that change issues when they are created or start matching conditions.',
    icon: Workflow,
    resource: 'work_items',
    group: 'automation',
  },
  {
    slug: 'webhooks',
    label: 'Webhooks',
    description: 'Send team events to external URLs, signed with a per-webhook secret.',
    icon: Webhook,
    resource: 'webhooks',
    group: 'automation',
  },
];

// The settings sections split by sidebar group.
export const GENERAL_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.group === 'general');
export const CONFIGURATION_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.group === 'configuration');
export const AUTOMATION_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.group === 'automation');

const BY_SLUG = new Map(SETTINGS_SECTIONS.map((s) => [s.slug, s]));

// The section config for a known slug. Throws on an unknown slug (a routing or
// typo bug); callers pass a literal slug matching a SETTINGS_SECTIONS entry.
export function settingsSection(slug: string): SettingsSection {
  const section = BY_SLUG.get(slug);
  if (!section) throw new Error(`Unknown settings section: ${slug}`);
  return section;
}
