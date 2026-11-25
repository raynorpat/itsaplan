import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contactErrors } from '../contact';

describe('contactErrors', () => {
  it('both missing → both required', () => {
    assert.deepEqual(contactErrors('', '  '), { email: 'Required', name: 'Required' });
  });

  it('an address without @ or domain is refused', () => {
    assert.deepEqual(contactErrors('sam', 'Sam'), { email: 'Enter an email address' });
    assert.deepEqual(contactErrors('sam@', 'Sam'), { email: 'Enter an email address' });
  });

  it('a valid address and a name → no errors', () => {
    assert.deepEqual(contactErrors(' sam@example.com ', 'Sam Carter'), {});
  });
});
