import { authedApi, type Api } from '../../__tests__/helpers/app';
import { signUpTestUser } from '../../__tests__/helpers/auth';

// Actors and the flows both god directory tests need. The first user in a reset
// database gets the "god" role, so `setup` registers the instance owner first and
// every other actor is a plain user.

export interface Actor {
  id: string;
  email: string;
  api: Api;
}

export async function addUser(overrides: { name?: string; email?: string } = {}): Promise<Actor> {
  const user = await signUpTestUser(overrides);
  return { id: user.userId, email: user.email, api: authedApi(user.cookie) };
}

export async function setup(): Promise<{ god: Actor }> {
  return { god: await addUser({ name: 'Root', email: 'root@example.com' }) };
}

// Adds `invitee` to the given team as a member or team owner, through the API.
export async function joinTeam(
  owner: Actor,
  invitee: Actor,
  teamKey: string,
  role: 'owner' | 'member',
): Promise<void> {
  await owner.api.teams({ teamKey }).members.post({ userId: invitee.id, owner: role === 'owner' });
}
