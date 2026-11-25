import {
  customer,
  cycle,
  dashboard,
  db,
  document,
  favorite,
  issue,
  label,
  project,
  projectLabel,
  team,
  teamView,
  user,
} from '@repo/db';
import { and, eq, inArray, isNull, or, sql, type Column, type SQL } from 'drizzle-orm';
import { readsCustomers } from '../customers/statuses';
import { listDashboards } from '../dashboards/store';
import { visibleDocumentsSql } from '../documents/access';
import { visibleLabels } from '../graphql/resolvers/issue-label';
import { visibleUsers } from '../graphql/resolvers/team';
import { projectsInTeams } from '../projects/access';
import {
  NON_GUEST_ROLES,
  visibleTeamIdList,
  visibleTeamIds,
  workspaceRole,
  type AuthUser,
} from '../shared/access';
import { viewSharedWith } from '../views/store';

// Which favorites a person sees: their own, whose target they can see now and is not
// archived or trashed (a folder or a workspace-wide fixed view always). One SQL
// condition over `favorite`, so the list and a lookup by id agree.

const notTrashed = (col: Column) => sql`coalesce(${col}, false) = false`;

export async function visibleFavoritesSql(viewer: AuthUser): Promise<SQL> {
  const teams = visibleTeamIds(viewer.id);
  const [teamList, documents, customers, role, dashboards] = await Promise.all([
    visibleTeamIdList(viewer.id),
    visibleDocumentsSql(viewer.id),
    readsCustomers(viewer.id),
    workspaceRole(viewer.id),
    listDashboards(viewer).catch(() => []),
  ]);
  const dashboardIds = dashboards.map((d) => d.id);
  const target = (col: Column, ids: Parameters<typeof inArray>[1]) =>
    and(sql`${col} IS NOT NULL`, inArray(col, ids));

  return and(
    eq(favorite.ownerId, viewer.id),
    or(
      sql`${favorite.folderName} IS NOT NULL`,
      and(
        sql`${favorite.predefinedViewType} IS NOT NULL`,
        or(isNull(favorite.teamId), inArray(favorite.teamId, teams)),
      ),
      target(
        favorite.issueId,
        db
          .select({ id: issue.id })
          .from(issue)
          .where(and(inArray(issue.teamId, teams), isNull(issue.archivedAt))),
      ),
      target(
        favorite.projectId,
        db
          .select({ id: project.id })
          .from(project)
          .where(
            and(
              inArray(project.id, projectsInTeams(teamList)),
              isNull(project.archivedAt),
              notTrashed(project.trashed),
            ),
          ),
      ),
      target(
        favorite.customViewId,
        db
          .select({ id: teamView.id })
          .from(teamView)
          .where(and(inArray(teamView.teamId, teams), viewSharedWith(viewer.id))),
      ),
      target(
        favorite.cycleId,
        db
          .select({ id: cycle.id })
          .from(cycle)
          .where(and(inArray(cycle.teamId, teams), isNull(cycle.archivedAt))),
      ),
      target(
        favorite.documentId,
        db
          .select({ id: document.id })
          .from(document)
          .where(and(documents, isNull(document.archivedAt), notTrashed(document.trashed))),
      ),
      target(
        favorite.labelId,
        db.select({ id: label.id }).from(label).where(visibleLabels(viewer.id)),
      ),
      NON_GUEST_ROLES.includes(role)
        ? target(favorite.projectLabelId, db.select({ id: projectLabel.id }).from(projectLabel))
        : undefined,
      customers
        ? target(favorite.customerId, db.select({ id: customer.id }).from(customer))
        : undefined,
      dashboardIds.length
        ? target(
            favorite.dashboardId,
            db
              .select({ id: dashboard.id })
              .from(dashboard)
              .where(inArray(dashboard.id, dashboardIds)),
          )
        : undefined,
      and(
        isNull(favorite.predefinedViewType),
        target(
          favorite.teamId,
          db.select({ id: team.id }).from(team).where(inArray(team.id, teams)),
        ),
      ),
      target(favorite.userId, db.select({ id: user.id }).from(user).where(visibleUsers(viewer.id))),
    ),
  )!;
}
