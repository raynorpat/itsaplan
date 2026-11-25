import type { TeamEstimateSettings } from '@/utils/estimates';

// The Estimates form as Linear's teamUpdate input.
export function estimateSettingsInput(s: TeamEstimateSettings) {
  return {
    issueEstimationType: s.type,
    issueEstimationExtended: s.extended,
    issueEstimationAllowZero: s.allowZero,
    defaultIssueEstimate: s.defaultEstimate,
  };
}

// The default estimate field's text as a number of at least 0; null when it is not one.
export function parseDefaultEstimate(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
