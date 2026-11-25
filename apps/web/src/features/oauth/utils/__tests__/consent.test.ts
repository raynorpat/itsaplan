import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { consentBody, requestedScopes } from '../consent';

// The consent page receives the plugin's signed authorization query in its URL and
// posts the person's answer back with it.
const QUERY = 'client_id=abc&scope=read+write+actor%3Aapp&exp=1&iat=2&sig=xyz';

describe('requestedScopes', () => {
  it('reads the space-separated scope parameter', () => {
    assert.deepEqual(requestedScopes(QUERY), ['read', 'write', 'actor:app']);
  });

  it('is empty without a scope', () => {
    assert.deepEqual(requestedScopes('client_id=abc&sig=x'), []);
  });
});

describe('consentBody', () => {
  it('denies with the signed query only, even for an app install', () => {
    assert.deepEqual(
      consentBody({
        accept: false,
        oauthQuery: QUERY,
        install: { publicTeams: false, teamIds: ['t1'] },
      }),
      { accept: false, oauth_query: QUERY },
    );
  });

  it('accepts every requested scope and passes the team selection of an app install', () => {
    assert.deepEqual(
      consentBody({
        accept: true,
        oauthQuery: QUERY,
        install: { publicTeams: false, teamIds: ['t1', 't2'] },
      }),
      {
        accept: true,
        oauth_query: QUERY,
        app_public_teams: false,
        app_team_ids: ['t1', 't2'],
      },
    );
  });

  it('sends no team selection for an authorization that is not an install', () => {
    assert.deepEqual(consentBody({ accept: true, oauthQuery: 'client_id=a&sig=b' }), {
      accept: true,
      oauth_query: 'client_id=a&sig=b',
    });
  });
});
