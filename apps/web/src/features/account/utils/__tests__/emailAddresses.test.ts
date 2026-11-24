import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emailStatusText } from '../emailAddresses';

// The Email addresses section of the profile page: each row's status.

describe('emailStatusText', () => {
  it('names the sign-in address', () => {
    assert.equal(emailStatusText({ signIn: true, verified: true }), 'Sign-in address');
  });
  it('marks a confirmed extra address', () => {
    assert.equal(emailStatusText({ signIn: false, verified: true }), 'Confirmed');
  });
  it('marks a pending address', () => {
    assert.equal(emailStatusText({ signIn: false, verified: false }), 'Pending confirmation');
  });
});
