import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeScopes, isAppInstall } from '@/utils/oauthScopes';

// The scopes an OAuth application asks for, in the words the consent screen and the
// authorized-apps lists show.
describe('describeScopes', () => {
  it('describes Linear scopes in plain words, in the order given', () => {
    assert.deepEqual(describeScopes(['read', 'write']), [
      { scope: 'read', label: 'Read your issues, projects, documents and workspace data' },
      { scope: 'write', label: 'Create and change issues, comments, projects and documents' },
    ]);
  });

  it('hides the internal app-install and refresh scopes', () => {
    assert.deepEqual(
      describeScopes(['read', 'actor:app', 'offline_access']).map((s) => s.scope),
      ['read'],
    );
  });

  it('describes the narrow and app scopes', () => {
    const labels = describeScopes([
      'issues:create',
      'comments:create',
      'admin',
      'app:assignable',
      'app:mentionable',
    ]).map((s) => s.label);
    assert.deepEqual(labels, [
      'Create issues and their attachments',
      'Create comments',
      'Act with your admin rights',
      'Be delegated issues',
      'Be mentioned',
    ]);
  });

  it('shows an unknown scope as it is', () => {
    assert.deepEqual(describeScopes(['custom']), [{ scope: 'custom', label: 'custom' }]);
  });

  it('drops repeated scopes', () => {
    assert.equal(describeScopes(['read', 'read']).length, 1);
  });
});

describe('isAppInstall', () => {
  it('is true only when the internal app-install scope is requested', () => {
    assert.equal(isAppInstall(['read', 'actor:app']), true);
    assert.equal(isAppInstall(['read', 'write']), false);
  });
});
