import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOAuthQuery, oauthResumePath } from '@/utils/oauthResume';

describe('isOAuthQuery', () => {
  it('recognises the signed authorization query the plugin sends to the login page', () => {
    assert.equal(isOAuthQuery('?client_id=abc&sig=xyz'), true);
    assert.equal(isOAuthQuery('client_id=abc&sig=xyz'), true);
    assert.equal(isOAuthQuery('?error=expired'), false);
    assert.equal(isOAuthQuery('?client_id=abc'), false);
  });
});

describe('oauthResumePath', () => {
  it('returns the page that resumes the authorization after sign-in', () => {
    assert.equal(oauthResumePath('?client_id=abc&sig=xyz'), '/oauth/resume?client_id=abc&sig=xyz');
  });

  it('is null outside an authorization', () => {
    assert.equal(oauthResumePath(''), null);
    assert.equal(oauthResumePath('?error=x'), null);
  });
});
