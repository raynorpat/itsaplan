import { cyclePath, feedbackCustomerPath, projectPath, teamPath } from '@/utils/paths';

// The app pages a widget's rows open.

// "ENG-42" → /team/ENG/issue/42 (issues are addressed by team key and number).
export function issueHref(identifier: string): string | null {
  const dash = identifier.lastIndexOf('-');
  if (dash <= 0) return null;
  return `${teamPath(identifier.slice(0, dash))}/issue/${identifier.slice(dash + 1)}`;
}

export const projectHref = (id: string): string => projectPath(null, id);

export const cycleHref = (teamKey: string, number: number): string => cyclePath(teamKey, number);

export const customerHref = (slugId: string): string => feedbackCustomerPath(slugId);

// "2026-11-24T10:00:00Z" → "2026-11-24".
export const dateCell = (at: string | null | undefined): string | null =>
  at ? at.slice(0, 10) : null;
