// Agent session events inside the API: `created` when a session starts, `prompted`
// when a person (or the server, for a stop) writes a prompt to it. Listeners (the
// AgentSessionEvent webhook) register with onAgentSessionEvent; emit awaits them in
// registration order.

export interface AgentSessionEvent {
  action: 'created' | 'prompted';
  sessionId: string;
  // The prompt activity of a `prompted` event.
  activityId?: string;
}

type Listener = (event: AgentSessionEvent) => Promise<void> | void;

const listeners: Listener[] = [];

export function onAgentSessionEvent(listener: Listener): void {
  listeners.push(listener);
}

export async function emitAgentSessionEvent(event: AgentSessionEvent): Promise<void> {
  for (const listener of listeners) await listener(event);
}
