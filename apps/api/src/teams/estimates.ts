import { db, issue, team } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { HttpError } from '../shared/lib';

// Linear's team estimate scales (Team.issueEstimationType). T-shirt sizes are stored
// as numbers: XS 1, S 2, M 3, L 5, XL 8, XXL 13, XXXL 21. `extended` adds the larger
// points; `allowZero` adds 0. `notUsed` turns estimates off.

export const ESTIMATION_TYPES = [
  'notUsed',
  'exponential',
  'fibonacci',
  'linear',
  'tShirt',
] as const;
export type EstimationType = (typeof ESTIMATION_TYPES)[number];

export const ESTIMATE_SCALES: Record<
  Exclude<EstimationType, 'notUsed'>,
  { base: number[]; extended: number[] }
> = {
  exponential: { base: [1, 2, 4, 8, 16], extended: [32, 64] },
  fibonacci: { base: [1, 2, 3, 5, 8], extended: [13, 21] },
  linear: { base: [1, 2, 3, 4, 5], extended: [6, 7] },
  tShirt: { base: [1, 2, 3, 5, 8], extended: [13, 21] },
};

export interface EstimateSettings {
  issueEstimationType: string;
  issueEstimationExtended: boolean;
  issueEstimationAllowZero: boolean;
}

export const isEstimationType = (value: unknown): value is EstimationType =>
  typeof value === 'string' && (ESTIMATION_TYPES as readonly string[]).includes(value);

// The values an estimate may take, in order, or null while estimates are off.
export function estimateScale(settings: EstimateSettings): number[] | null {
  const type = settings.issueEstimationType;
  if (!isEstimationType(type) || type === 'notUsed') return null;
  const scale = ESTIMATE_SCALES[type];
  return [
    ...(settings.issueEstimationAllowZero ? [0] : []),
    ...scale.base,
    ...(settings.issueEstimationExtended ? scale.extended : []),
  ];
}

// Progress inputs for an issue joined with its team: a team that does not use
// estimates has its stored estimates ignored and counts each issue as 1 (by issue),
// as Linear hides estimates entirely while they are off.
const estimatesOff = sql`${team.issueEstimationType} = 'notUsed'`;
export const usedEstimateSql = () =>
  sql<number | null>`CASE WHEN ${estimatesOff} THEN NULL ELSE ${issue.estimate} END`.mapWith(
    Number,
  );
export const usedDefaultEstimateSql = () =>
  sql<number>`CASE WHEN ${estimatesOff} THEN 1 ELSE ${team.defaultIssueEstimate} END`.mapWith(
    Number,
  );

export function isValidEstimate(settings: EstimateSettings, value: number): boolean {
  return estimateScale(settings)?.includes(value) ?? false;
}

// Refuses an estimate that is not on the team's scale (or any estimate while the team
// does not use estimates). `null` / undefined (clearing, or no change) always passes.
export async function assertEstimate(
  teamId: string,
  estimate: number | null | undefined,
): Promise<void> {
  if (estimate === undefined || estimate === null) return;
  const [settings] = await db
    .select({
      issueEstimationType: team.issueEstimationType,
      issueEstimationExtended: team.issueEstimationExtended,
      issueEstimationAllowZero: team.issueEstimationAllowZero,
    })
    .from(team)
    .where(eq(team.id, teamId));
  if (!settings) throw new HttpError(404, 'Team not found');
  const scale = estimateScale(settings);
  if (!scale) throw new HttpError(400, 'The team does not use estimates');
  if (!scale.includes(estimate))
    throw new HttpError(400, `estimate must be one of ${scale.join(', ')} for this team`);
}

export interface EstimateSettingsPatch extends Partial<EstimateSettings> {
  defaultIssueEstimate?: number;
}

// Checks Linear's TeamUpdateInput estimate fields; throws 400 on a bad value.
export function validateEstimateSettings(input: Record<string, unknown>): EstimateSettingsPatch {
  const patch: EstimateSettingsPatch = {};
  if (input.issueEstimationType != null) {
    if (!isEstimationType(input.issueEstimationType))
      throw new HttpError(400, `issueEstimationType must be one of ${ESTIMATION_TYPES.join(', ')}`);
    patch.issueEstimationType = input.issueEstimationType;
  }
  for (const field of ['issueEstimationExtended', 'issueEstimationAllowZero'] as const) {
    if (input[field] == null) continue;
    if (typeof input[field] !== 'boolean') throw new HttpError(400, `${field} must be a boolean`);
    patch[field] = input[field];
  }
  if (input.defaultIssueEstimate != null) {
    const value = input.defaultIssueEstimate;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw new HttpError(400, 'defaultIssueEstimate must be a number of at least 0');
    patch.defaultIssueEstimate = value;
  }
  // Sub-teams are not implemented, so nothing inherits.
  if (input.inheritIssueEstimation === true)
    throw new HttpError(400, 'inheritIssueEstimation is not supported (there are no sub-teams)');
  return patch;
}

export async function setEstimateSettings(
  teamId: string,
  patch: EstimateSettingsPatch,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db.update(team).set(patch).where(eq(team.id, teamId));
}
