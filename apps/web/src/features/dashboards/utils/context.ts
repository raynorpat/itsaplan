import type { InsightsContext } from '@/utils/insights/slices';

// The Insights names for a widget's figures. Across all teams a status slice groups the
// teams' states by name ("In Progress" once, not once per team), as My issues does.
export function widgetInsightsContext(
  names: InsightsContext,
  teamId: string | null,
): InsightsContext {
  return { ...names, groupStatesByName: teamId === null };
}
