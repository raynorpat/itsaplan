// Who made a change or wrote a comment, as Linear shows it: a person, an app user
// (an OAuth application installed with actor=app, marked with an "App" badge) or a
// workflow (Linear's ActorBot of type "workflow", shown as "via workflow <name>").
export type ActorKind = 'user' | 'app' | 'workflow' | 'unknown';

export function actorDisplay(entry: {
  actor?: { name: string; app?: boolean } | null;
  botActor?: { type?: string | null; name?: string | null } | null;
}): { kind: ActorKind; name: string } {
  if (entry.botActor?.type === 'workflow')
    return { kind: 'workflow', name: entry.botActor.name || 'a workflow' };
  if (entry.actor) return { kind: entry.actor.app ? 'app' : 'user', name: entry.actor.name };
  return { kind: 'unknown', name: '' };
}
