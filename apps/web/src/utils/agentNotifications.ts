import type { NotificationType } from '@/types/notification';

// Linear's agent session notification types, as the inbox names them.
const AGENT_TYPES: Record<string, NotificationType> = {
  agentSessionNeedsInput: 'agent_needs_input',
  agentSessionResponse: 'agent_response',
};

export const agentNotificationType = (type: string): NotificationType | null =>
  AGENT_TYPES[type] ?? null;
