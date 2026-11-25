import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { externalCreatorText } from '../externalCreator';

describe('externalCreatorText', () => {
  it('names the form a request came through', () => {
    assert.equal(
      externalCreatorText('Sam', ['Logged by Pat', 'Form: Bug report']),
      'Submitted by Sam through the Bug report form',
    );
  });

  it('says a portal suggestion came from the portal', () => {
    assert.equal(externalCreatorText('Sam', ['Portal']), 'Suggested by Sam on the portal');
  });

  it('is neutral without a known source', () => {
    assert.equal(externalCreatorText('Sam', []), 'Submitted by Sam');
  });
});
