import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { githubCallbackParams } from '../githubCallback';

describe('githubCallbackParams', () => {
  const query = (q: string) => new URLSearchParams(q);
  const notStarted = {
    error: 'This GitHub connection was not started from this browser. Start it again.',
  };
  const noAuthorization = {
    error: 'GitHub did not return an authorization. Start the connection again.',
  };

  it('takes the code and installation id when the state matches', () => {
    assert.deepEqual(
      githubCallbackParams(
        query('code=abc&installation_id=42&state=s1&setup_action=install'),
        's1',
      ),
      { code: 'abc', installationId: '42' },
    );
  });

  it('refuses a state that is missing or different', () => {
    assert.deepEqual(
      githubCallbackParams(query('code=abc&installation_id=42&state=s2'), 's1'),
      notStarted,
    );
    assert.deepEqual(
      githubCallbackParams(query('code=abc&installation_id=42&state=s1'), null),
      notStarted,
    );
  });

  it('needs a code and an installation id', () => {
    assert.deepEqual(
      githubCallbackParams(query('installation_id=42&state=s1'), 's1'),
      noAuthorization,
    );
    assert.deepEqual(githubCallbackParams(query('code=abc&state=s1'), 's1'), noAuthorization);
  });
});
