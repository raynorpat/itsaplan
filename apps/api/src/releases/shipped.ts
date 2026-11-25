import {
  db,
  issue,
  issueToRelease,
  release,
  releasePipeline,
  releaseStage,
  requesterShipped,
  workflowState,
} from '@repo/db';
import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';

// When an issue shipped (spec: release tracking, "Shipped" updates): it is in a release
// of a production pipeline, the release is in a completed stage, and the issue is
// completed. It ships at the latest of the three moments, so an issue completed after
// its release, or added to a completed release, ships then.

export const shippedAtSql: SQL<Date> = sql<Date>`greatest(
  ${issueToRelease.createdAt}, ${release.completedAt}, ${issue.completedAt})`;

// The conditions on issue_to_release joined with release, its stage, release_pipeline,
// issue and the issue's workflow state. A `completedAt` set on a release still in
// progress (releaseUpdate takes one) is not a completion.
const shippedSql: SQL = and(
  eq(releasePipeline.isProduction, true),
  eq(releasePipeline.trashed, false),
  eq(releaseStage.type, 'completed'),
  isNotNull(release.completedAt),
  isNull(release.canceledAt),
  eq(release.trashed, false),
  isNotNull(issue.completedAt),
  eq(workflowState.stateType, 'completed'),
)!;

export interface Shipment {
  issueId: string;
  releaseId: string;
  releaseName: string;
  shippedAt: Date;
}

const shipmentColumns = {
  issueId: issueToRelease.issueId,
  releaseId: issueToRelease.releaseId,
  releaseName: release.name,
  shippedAt: shippedAtSql,
};

function shipments(where: SQL) {
  return db
    .select(shipmentColumns)
    .from(issueToRelease)
    .innerJoin(release, eq(release.id, issueToRelease.releaseId))
    .innerJoin(releaseStage, eq(releaseStage.id, release.stageId))
    .innerJoin(releasePipeline, eq(releasePipeline.id, release.pipelineId))
    .innerJoin(issue, eq(issue.id, issueToRelease.issueId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(and(shippedSql, where));
}

// The issues of `issueIds` that shipped in (since, until] and were not already sent to
// the requester before the window: a row in requester_shipped sent at or before `since`
// means the person heard about it, so a later reopen and completion is not news. A row
// sent after `since` (a change email of the same window) does not hide it, so a summary
// covering the window still lists it.
export async function shipmentsFor(
  requesterId: string,
  issueIds: string[],
  since: Date,
  until: Date,
): Promise<Shipment[]> {
  if (issueIds.length === 0) return [];
  const rows = await shipments(
    and(
      inArray(issueToRelease.issueId, issueIds),
      sql`${shippedAtSql} > ${since.toISOString()}`,
      sql`${shippedAtSql} <= ${until.toISOString()}`,
      sql`NOT EXISTS (SELECT 1 FROM ${requesterShipped}
        WHERE ${requesterShipped.requesterId} = ${requesterId}
          AND ${requesterShipped.issueId} = ${issueToRelease.issueId}
          AND ${requesterShipped.releaseId} = ${issueToRelease.releaseId}
          AND ${requesterShipped.sentAt} <= ${since.toISOString()})`,
    )!,
  );
  return rows.map((r) => ({ ...r, shippedAt: new Date(r.shippedAt) }));
}

// The latest release the issue shipped in, for the portal issue page.
export async function latestShipment(issueId: string): Promise<Shipment | null> {
  const [row] = await shipments(eq(issueToRelease.issueId, issueId))
    .orderBy(desc(shippedAtSql))
    .limit(1);
  return row ? { ...row, shippedAt: new Date(row.shippedAt) } : null;
}

// SQL over the outer `issue` row (`issueIdSql`): whether it shipped after `after`, for
// the run's candidate lookup.
export const shippedAfterSql = (issueIdSql: SQL, after: string): SQL =>
  sql`EXISTS (SELECT 1 FROM issue_to_release itr
    JOIN release r ON r.id = itr.release_id
    JOIN release_stage rs ON rs.id = r.stage_id AND rs.type = 'completed'
    JOIN release_pipeline p ON p.id = r.pipeline_id
    JOIN issue i ON i.id = itr.issue_id
    JOIN workflow_state s ON s.id = i.state_id
    WHERE itr.issue_id = ${issueIdSql}
      AND p.is_production AND NOT p.trashed
      AND r.completed_at IS NOT NULL AND r.canceled_at IS NULL AND NOT r.trashed
      AND i.completed_at IS NOT NULL AND s.state_type = 'completed'
      AND greatest(itr.created_at, r.completed_at, i.completed_at) > ${after})`;

// Records that the person was told about these shipments (in the step that marks an
// email sent). A shipment already recorded keeps its first time.
export async function recordShipped(
  requesterId: string,
  items: { issueId: string; releaseId: string }[],
  sentAt: Date,
  executor: Pick<typeof db, 'insert'> = db,
): Promise<void> {
  if (items.length === 0) return;
  await executor
    .insert(requesterShipped)
    .values(items.map((i) => ({ requesterId, ...i, sentAt })))
    .onConflictDoNothing();
}
