import type { View } from '@/types/team';

export interface TeamViews {
  teamKey: string;
  teamName: string;
  views: View[];
}

// The workspace Views page's sections: one per team, teams by name, each team's
// views most recently changed first.
export function viewsByTeam(views: View[]): TeamViews[] {
  const byTeam = new Map<string, TeamViews>();
  for (const view of views) {
    let section = byTeam.get(view.teamKey);
    if (!section) {
      section = { teamKey: view.teamKey, teamName: view.teamName, views: [] };
      byTeam.set(view.teamKey, section);
    }
    section.views.push(view);
  }
  const sections = [...byTeam.values()].sort((a, b) => a.teamName.localeCompare(b.teamName));
  for (const s of sections) s.views.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sections;
}
