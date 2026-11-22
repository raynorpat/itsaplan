import { setWorkspaceRole, type WorkspaceRole } from '../../shared/access';
import { authedApi, type Api } from './app';
import { signUpTestUser, type TestUser } from './auth';

// Test setup for Linear's access model: a user with a workspace role, added to a
// team through the invite flow, and a team made private.

export async function signUpWithRole(
  role: WorkspaceRole,
  overrides: { email?: string; name?: string } = {},
): Promise<TestUser & { api: Api }> {
  const u = await signUpTestUser(overrides);
  await setWorkspaceRole(u.userId, role);
  return { ...u, api: authedApi(u.cookie) };
}

export async function addToTeam(owner: Api, teamKey: string, who: TestUser): Promise<void> {
  const invite = await owner.teams({ teamKey }).invites.post({ email: who.email, role: 'member' });
  await authedApi(who.cookie).invites({ token: invite.data!.token }).accept.post();
}

export async function makePrivate(owner: Api, teamKey: string): Promise<void> {
  await owner.teams({ teamKey }).patch({ visibility: 'private' });
}
