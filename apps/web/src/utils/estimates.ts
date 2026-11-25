// Linear's team estimate scales (Team.issueEstimationType and its options). The API
// refuses an estimate off the team's scale (apps/api src/teams/estimates.ts); the web
// offers only the scale's values and shows T-shirt teams' values as sizes.

export type EstimationType = 'notUsed' | 'exponential' | 'fibonacci' | 'linear' | 'tShirt';

export interface TeamEstimateSettings {
  type: EstimationType;
  extended: boolean;
  allowZero: boolean;
  // What an unestimated issue counts as in progress.
  defaultEstimate: number;
}

export const DEFAULT_ESTIMATE_SETTINGS: TeamEstimateSettings = {
  type: 'notUsed',
  extended: false,
  allowZero: false,
  defaultEstimate: 1,
};

export const ESTIMATION_TYPES: { value: EstimationType; label: string }[] = [
  { value: 'notUsed', label: 'Not in use' },
  { value: 'exponential', label: 'Exponential (1, 2, 4, 8, 16)' },
  { value: 'fibonacci', label: 'Fibonacci (1, 2, 3, 5, 8)' },
  { value: 'linear', label: 'Linear (1, 2, 3, 4, 5)' },
  { value: 'tShirt', label: 'T-shirt sizes (XS, S, M, L, XL)' },
];

const SCALES: Record<Exclude<EstimationType, 'notUsed'>, { base: number[]; extended: number[] }> = {
  exponential: { base: [1, 2, 4, 8, 16], extended: [32, 64] },
  fibonacci: { base: [1, 2, 3, 5, 8], extended: [13, 21] },
  linear: { base: [1, 2, 3, 4, 5], extended: [6, 7] },
  tShirt: { base: [1, 2, 3, 5, 8], extended: [13, 21] },
};

const T_SHIRT: Record<number, string> = {
  1: 'XS',
  2: 'S',
  3: 'M',
  5: 'L',
  8: 'XL',
  13: 'XXL',
  21: 'XXXL',
};

export const estimatesUsed = (s: TeamEstimateSettings): boolean => s.type !== 'notUsed';

// An estimate as the team shows it: a T-shirt size, else the number.
export function estimateLabel(s: TeamEstimateSettings, value: number): string {
  if (s.type === 'tShirt' && T_SHIRT[value]) return T_SHIRT[value];
  return String(value);
}

// The values the team's scale allows, in order; none while estimates are not used.
export function estimateOptions(s: TeamEstimateSettings): { value: number; label: string }[] {
  if (s.type === 'notUsed') return [];
  const scale = SCALES[s.type];
  const values = [
    ...(s.allowZero ? [0] : []),
    ...scale.base,
    ...(s.extended ? scale.extended : []),
  ];
  return values.map((value) => ({ value, label: estimateLabel(s, value) }));
}

// Display options (properties, orderings) without the estimate one for a team that does
// not estimate.
export function withoutEstimateOptions<T extends { value: string }>(
  options: T[],
  estimatesOn: boolean,
): T[] {
  return estimatesOn ? options : options.filter((o) => o.value !== 'estimate');
}
