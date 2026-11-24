// Who made a change or wrote a comment, as Linear shows it: a person, an app user
// (an OAuth application installed with actor=app, marked with an "App" badge), a
// workflow (Linear's ActorBot of type "workflow", shown as "via workflow <name>") or a
// portal visitor (Linear's Comment.externalUser, marked "Portal"). Guests get no
// visitor, so `portal` alone (a comment in a portal thread) shows "Portal visitor".
export type ActorKind = 'user' | 'app' | 'workflow' | 'visitor' | 'unknown';

export const PORTAL_VISITOR = 'Portal visitor';

export function actorDisplay(entry: {
  actor?: { name: string; app?: boolean } | null;
  botActor?: { type?: string | null; name?: string | null } | null;
  externalUser?: { name: string } | null;
  portal?: boolean;
}): { kind: ActorKind; name: string } {
  if (entry.botActor?.type === 'workflow')
    return { kind: 'workflow', name: entry.botActor.name || 'a workflow' };
  if (entry.actor) return { kind: entry.actor.app ? 'app' : 'user', name: entry.actor.name };
  if (entry.externalUser) return { kind: 'visitor', name: entry.externalUser.name };
  if (entry.portal) return { kind: 'visitor', name: PORTAL_VISITOR };
  return { kind: 'unknown', name: '' };
}
