// A requester's email update preferences, as the portal's /me/updates and
// /unsubscribe routes return them.
export type SummaryCadence = 'weekly' | 'daily' | 'off';

export interface UpdatePrefs {
  enabled: boolean;
  unsubscribed: boolean;
  changeEmails: boolean;
  summary: SummaryCadence;
}

export const CADENCES: readonly SummaryCadence[] = ['weekly', 'daily', 'off'];

export function cadenceLabel(cadence: SummaryCadence): 'Weekly' | 'Daily' | 'Off' {
  switch (cadence) {
    case 'weekly':
      return 'Weekly';
    case 'daily':
      return 'Daily';
    case 'off':
      return 'Off';
  }
}

// One line naming what the person receives.
export function updatesSummary(prefs: UpdatePrefs): string {
  const summary = prefs.summary === 'off' ? null : prefs.summary;
  if (!prefs.enabled || (!prefs.changeEmails && !summary)) return 'Off';
  if (prefs.changeEmails && summary) return `Changes and a ${summary} summary`;
  if (summary) return `${cadenceLabel(summary)} summary only`;
  return 'Changes only';
}
