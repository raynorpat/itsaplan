import { Elysia } from 'elysia';
import { authContext } from './auth-context';
import {
  requireTeamAccess,
  requireTeamPermission,
  requireTeamOwner,
  assertPermission,
  assertMcpEnabled,
  type AuthUser,
} from './access';
import { getTeamById } from '../teams/store';
import { isMcpRequest } from './mcp-request';
import { HttpError } from './lib';
import type { PermissionResource, PermissionAction } from './permissions';

// A [resource, action] pair naming one cell of the role permission matrix.
export type Permission = [PermissionResource, PermissionAction];

// The slice of the request context an entity guard reads. Annotated explicitly
// because the factory is defined outside a plugin, so there is no context to
// infer from. It is a supertype of Elysia's route context (params widened, user
// optional) so the resolve is assignable wherever the macro is used; `user` is
// populated at runtime by authContext.
type EntityGuardCtx = {
  params: Record<string, unknown>;
  user?: AuthUser | null;
  request: Request;
};

// Builds a feature-local macro for routes that address an entity by its own id
// (no :teamKey in the path). resolveTeamId maps the route params to the
// entity's owning team id (null means the entity was not found). The macro
// asserts the given action on `resource` and injects the resolved `teamId` into
// the handler context, so a handler that needs it does not resolve it again. Used
// like:
//
//   .macro({
//     workItem: entityGuard("work_items", "Issue not found",
//       (p) => getIssueTeamId(p.issueId)),
//   })
//   .patch("/issues/:issueId", handler, { workItem: "edit" })
export function entityGuard(
  resource: PermissionResource,
  notFound: string,
  resolveTeamId: (params: Record<string, string>) => Promise<string | null>,
) {
  return (action: PermissionAction) => ({
    async resolve({ params, user, request }: EntityGuardCtx) {
      const teamId = await resolveTeamId(params as Record<string, string>);
      if (teamId == null) throw new HttpError(404, notFound);
      await assertPermission(teamId, user, resource, action);
      if (isMcpRequest(request.headers)) {
        const team = await getTeamById(teamId);
        if (team) assertMcpEnabled(team, true);
      }
      return { teamId };
    },
  });
}

// The path param carried by every team-scoped route. The macros read it off
// the resolved params; Elysia always parses path segments, so it is present at
// runtime even on routes that do not declare a params schema.
type TeamKeyParams = { teamKey: string };

// Declarative access guards for routes whose path carries :teamKey. Each
// macro resolves the team once, enforces access, and injects the resolved
// `team` row into the handler context, so a handler reads `team` instead
// of resolving and checking it itself.
//
// The plugin uses authContext, so `user` is on the context before a guard runs.
// A feature plugin with :teamKey routes does `.use(guards)` at the top of its
// chain and sets the guard in each route's options:
//
//   .post("/teams/:teamKey/columns", ({ team, body }) => ..., {
//     permission: ["states", "create"],
//   })
//
// A guard that denies throws an HttpError, which the planner onError maps to the
// JSON error response.
export const guards = new Elysia({ name: 'guards' }).use(authContext).macro({
  // Bare membership: any member of the team may proceed.
  teamMember(_enabled: boolean) {
    return {
      async resolve({ params, user, request }) {
        const team = await requireTeamAccess((params as TeamKeyParams).teamKey, user);
        assertMcpEnabled(team, isMcpRequest(request.headers));
        return { team };
      },
    };
  },

  // A specific permission on the role matrix (owners bypass the matrix).
  permission(permission: Permission) {
    return {
      async resolve({ params, user, request }) {
        const team = await requireTeamPermission(
          (params as TeamKeyParams).teamKey,
          user,
          permission[0],
          permission[1],
        );
        assertMcpEnabled(team, isMcpRequest(request.headers));
        return { team };
      },
    };
  },

  // Owner-only actions (role and member management). A non-member gets 403 for
  // access rather than leaking owner-ness, since membership is resolved before
  // the owner check.
  teamOwner(_enabled: boolean) {
    return {
      async resolve({ params, user, request }) {
        const team = await requireTeamOwner((params as TeamKeyParams).teamKey, user);
        assertMcpEnabled(team, isMcpRequest(request.headers));
        return { team };
      },
    };
  },
});
