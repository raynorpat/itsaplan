import {
  Archive,
  Bot,
  BookText,
  Clock3,
  Columns3,
  Info,
  KeyRound,
  type LucideIcon,
  Tags,
  Webhook,
  Wrench,
} from 'lucide-react';
import type { PermissionResource } from '@/lib/api';

// The sidebar group a section is listed under: the team-level general
// settings, workflow configuration, automation/integrations, or the AI section
// (agents, providers, skills). 'ai-team' sections are listed in the main sidebar's
// AI Team group next to the chat, not in the team settings sidebar.
export type SettingsGroup = 'general' | 'configuration' | 'automation' | 'ai' | 'ai-team';

// The team settings sections, each mounted as its own page at
// /team/:teamKey/settings/:section, except the 'ai-team' group, which is
// mounted at /team/:teamKey/ai-team/:section. The slug is the route param; the tab
// components live in features/settings/components and take { team }. `resource`
// is the permission resource that gates the section: read to view it, and the
// create/edit/delete actions gate the controls inside. `group` places it in the
// sidebar (see CONFIGURATION_SECTIONS / AUTOMATION_SECTIONS).
export type SettingsSection = {
  slug: string;
  label: string;
  description: string;
  icon: LucideIcon;
  resource: PermissionResource;
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
    slug: 'archive',
    label: 'Archive',
    description: 'Auto-archive stale completed and canceled issues so the board stays clear.',
    icon: Archive,
    resource: 'work_items',
    group: 'configuration',
  },
  {
    slug: 'schedules',
    label: 'Schedules',
    description: 'Run agent tasks on a recurring schedule.',
    icon: Clock3,
    resource: 'ai_agents',
    group: 'ai-team',
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

// The AI section items are their own nav routes (not /settings/:section pages), but
// reuse the SettingsSection shape for their page header and permission resource.
// They sit in the AI sidebar group and are all gated by the ai_agents resource.
export const AI_AGENTS_SECTION: SettingsSection = {
  slug: 'ai-agents',
  label: 'Agents',
  description: 'Bot users you can delegate issues to.',
  icon: Bot,
  resource: 'ai_agents',
  group: 'ai',
};

export const INTEGRATIONS_SECTION: SettingsSection = {
  slug: 'integrations',
  label: 'Integrations',
  description:
    'Credentials your agents use to reach AI providers and tools. Stored encrypted and never shown again.',
  icon: KeyRound,
  resource: 'integrations',
  group: 'ai',
};

export const AGENT_SKILLS_SECTION: SettingsSection = {
  slug: 'agent-skills',
  label: 'Skills',
  description: 'Reusable instructions internal agents load on demand.',
  icon: BookText,
  resource: 'agent_skills',
  group: 'ai',
};

export const AGENT_TOOLS_SECTION: SettingsSection = {
  slug: 'agent-tools',
  label: 'Tools',
  description: 'Tools agents can call, each connected to an integration credential.',
  icon: Wrench,
  resource: 'agent_tools',
  group: 'ai',
};

// The AI section's nav items, in sidebar order.
export const AI_SECTIONS: SettingsSection[] = [
  AI_AGENTS_SECTION,
  INTEGRATIONS_SECTION,
  AGENT_SKILLS_SECTION,
  AGENT_TOOLS_SECTION,
];

// The settings sections split by sidebar group.
export const GENERAL_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.group === 'general');
export const CONFIGURATION_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.group === 'configuration');
export const AUTOMATION_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.group === 'automation');
export const AI_TEAM_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.group === 'ai-team');

const BY_SLUG = new Map(SETTINGS_SECTIONS.map((s) => [s.slug, s]));

// The section config for a known slug. Throws on an unknown slug (a routing or
// typo bug); callers pass a literal slug matching a SETTINGS_SECTIONS entry.
export function settingsSection(slug: string): SettingsSection {
  const section = BY_SLUG.get(slug);
  if (!section) throw new Error(`Unknown settings section: ${slug}`);
  return section;
}
