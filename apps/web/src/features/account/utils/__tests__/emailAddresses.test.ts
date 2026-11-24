import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { confirmResult, emailStatusText } from '../emailAddresses';

// The Email addresses section of the profile page: each row's status, and the result
// the confirmation link reports when it lands back on the page.

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

describe('confirmResult', () => {
  it('reads a confirmed link', () => {
    assert.deepEqual(confirmResult(new URLSearchParams('emailConfirmed=1')), {
      ok: true,
      message: 'Email address confirmed',
    });
  });
  it('reads a failed link with its message', () => {
    assert.deepEqual(
      confirmResult(new URLSearchParams('emailConfirmError=The%20link%20has%20expired')),
      { ok: false, message: 'The link has expired' },
    );
  });
  it('is null without either parameter', () => {
    assert.equal(confirmResult(new URLSearchParams('')), null);
  });
});
