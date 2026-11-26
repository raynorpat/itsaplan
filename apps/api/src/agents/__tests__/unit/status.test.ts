import { describe, expect, it } from 'bun:test';
import { sessionStatusAfter } from '../../status';

// Linear's session lifecycle: thoughts and actions mark the agent working from any
// state. A person's prompt starts a new turn the agent has not acknowledged yet; a
// stop prompt asks the agent to stop. The agent's own activities (elicitation,
// response, error) are covered by agent-sessions.test.ts.

describe('sessionStatusAfter', () => {
  it('moves to active on a thought or an action', () => {
    for (const from of ['pending', 'awaitingInput', 'complete', 'stale'] as const) {
      expect(sessionStatusAfter(from, { type: 'thought' })).toBe('active');
      expect(sessionStatusAfter(from, { type: 'action' })).toBe('active');
    }
  });

  it('starts an unacknowledged turn on a prompt, and stops on a stop prompt', () => {
    expect(sessionStatusAfter('complete', { type: 'prompt' })).toBe('pending');
    expect(sessionStatusAfter('awaitingInput', { type: 'prompt' })).toBe('pending');
    expect(sessionStatusAfter('active', { type: 'prompt', signal: 'stop' })).toBe('stopping');
  });
});
