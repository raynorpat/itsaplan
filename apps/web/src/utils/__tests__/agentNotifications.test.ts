import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentNotificationType } from '@/utils/agentNotifications';

describe('agentNotificationType', () => {
  it("maps Linear's agent session notification types", () => {
    assert.equal(agentNotificationType('agentSessionNeedsInput'), 'agent_needs_input');
    assert.equal(agentNotificationType('agentSessionResponse'), 'agent_response');
  });

  it('returns null for other kinds', () => {
    assert.equal(agentNotificationType('issueAssignedToYou'), null);
  });
});
