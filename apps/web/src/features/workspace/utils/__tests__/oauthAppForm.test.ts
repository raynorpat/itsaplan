import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appFormInput, emptyAppForm } from '../oauthAppForm';

// The OAuth application form, as the instance plugin's create and update endpoints
// take it.
describe('appFormInput', () => {
  it('splits redirect URIs by line, trims them and drops blank lines', () => {
    const input = appFormInput({
      ...emptyAppForm(),
      name: '  Deploy bot ',
      redirectUris: ' https://a.example/cb \n\nhttps://b.example/cb\n',
    });
    assert.equal(input.name, 'Deploy bot');
    assert.deepEqual(input.redirectUris, ['https://a.example/cb', 'https://b.example/cb']);
  });

  it('sends blank optional fields as null', () => {
    const input = appFormInput({ ...emptyAppForm(), name: 'A', redirectUris: 'https://a/cb' });
    assert.equal(input.description, null);
    assert.equal(input.developer, null);
    assert.equal(input.developerUrl, null);
    assert.equal(input.iconUrl, null);
    assert.equal(input.webhookUrl, null);
  });

  it('sends the webhook resource types only with a webhook URL', () => {
    const without = appFormInput({
      ...emptyAppForm(),
      name: 'A',
      redirectUris: 'https://a/cb',
      webhookResourceTypes: ['Issue'],
    });
    assert.equal(without.webhookResourceTypes, undefined);
    const withHook = appFormInput({
      ...emptyAppForm(),
      name: 'A',
      redirectUris: 'https://a/cb',
      webhookUrl: ' https://hooks.example/in ',
      webhookResourceTypes: ['Issue', 'Comment'],
    });
    assert.equal(withHook.webhookUrl, 'https://hooks.example/in');
    assert.deepEqual(withHook.webhookResourceTypes, ['Issue', 'Comment']);
  });

  it('carries the client type and the client credentials toggle', () => {
    const input = appFormInput({
      ...emptyAppForm(),
      name: 'A',
      redirectUris: 'https://a/cb',
      publicClient: true,
      clientCredentials: true,
    });
    assert.equal(input.publicClient, true);
    assert.equal(input.clientCredentials, true);
  });
});
