import { Elysia } from 'elysia';
import { authContext } from './auth-context';
import {
  assertTeamAccess,
  assertTeamWebhookAccess,
  requireTeamAccess,
  type AuthUser,
  type TeamLevel,
} from './access';
import { HttpError } from './lib';

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
// (no :teamKey in the path). resolveTeamId maps the route params to the entity's
// owning team id (null means the entity was not found). The macro asserts the
// team level (see / manage) and injects the resolved `teamId` into the handler
// context. Used like:
//
//   .macro({
//     workItem: entityGuard("Issue not found", (p) => getIssueTeamId(p.issueId)),
//   })
//   .patch("/issues/:issueId", handler, { workItem: "see" })
export function entityGuard(
  notFound: string,
  resolveTeamId: (params: Record<string, string>) => Promise<string | null>,
) {
  return (level: TeamLevel) => ({
    async resolve({ params, user }: EntityGuardCtx) {
      const teamId = await resolveTeamId(params as Record<string, string>);
      if (teamId == null) throw new HttpError(404, notFound);
      await assertTeamAccess(teamId, user, level, notFound);
      return { teamId };
    },
  });
}

// The path param carried by every team-scoped route. The macros read it off
// the resolved params; Elysia always parses path segments, so it is present at
// runtime even on routes that do not declare a params schema.
type TeamKeyParams = { teamKey: string };

// Declarative access guards for routes whose path carries :teamKey. Each macro
// resolves the team once, enforces access, and injects the resolved `team` row
// into the handler context. A feature plugin with :teamKey routes does
// `.use(guards)` at the top of its chain and sets the guard in each route's
// options:
//
//   .post("/teams/:teamKey/states", ({ team, body }) => ..., { teamAccess: "manage" })
//
// A guard that denies throws an HttpError, which the planner onError maps to the
// JSON error response.
export const guards = new Elysia({ name: 'guards' }).use(authContext).macro({
  // `see`: read or work in the team; `manage`: its settings and members.
  teamAccess(level: TeamLevel) {
    return {
      async resolve({ params, user }) {
        const team = await requireTeamAccess((params as TeamKeyParams).teamKey, user, level);
        return { team };
      },
    };
  },

  // The team's webhooks: workspace admins and owners who can see the team.
  teamWebhooks(_enabled: boolean) {
    return {
      async resolve({ params, user }) {
        const team = await requireTeamAccess((params as TeamKeyParams).teamKey, user, 'see');
        await assertTeamWebhookAccess(team.id, user);
        return { team };
      },
    };
  },
});
