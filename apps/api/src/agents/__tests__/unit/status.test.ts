import { describe, expect, it } from 'bun:test';
import { sessionStatusAfter } from '../../status';

// Linear's session lifecycle: thoughts and actions mark the agent working, an
// elicitation waits for the user, a response completes the turn unless it carries
// the continue signal, an error fails it. A person's prompt starts a new turn the
// agent has not acknowledged yet; a stop prompt asks the agent to stop.

describe('sessionStatusAfter', () => {
  it('moves to active on a thought or an action', () => {
    for (const from of ['pending', 'awaitingInput', 'complete', 'stale'] as const) {
      expect(sessionStatusAfter(from, { type: 'thought' })).toBe('active');
      expect(sessionStatusAfter(from, { type: 'action' })).toBe('active');
    }
  });

  it('waits for input on an elicitation', () => {
    expect(sessionStatusAfter('active', { type: 'elicitation' })).toBe('awaitingInput');
  });

  it('completes on a response, unless it carries continue', () => {
    expect(sessionStatusAfter('active', { type: 'response' })).toBe('complete');
    expect(sessionStatusAfter('active', { type: 'response', signal: 'continue' })).toBe('active');
  });

  it('fails on an error', () => {
    expect(sessionStatusAfter('active', { type: 'error' })).toBe('error');
  });

  it('starts an unacknowledged turn on a prompt, and stops on a stop prompt', () => {
    expect(sessionStatusAfter('complete', { type: 'prompt' })).toBe('pending');
    expect(sessionStatusAfter('awaitingInput', { type: 'prompt' })).toBe('pending');
    expect(sessionStatusAfter('active', { type: 'prompt', signal: 'stop' })).toBe('stopping');
  });
});
