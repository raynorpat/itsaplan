import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aiFormErrors, normalizeBaseUrl } from '../aiSettings';

describe('normalizeBaseUrl', () => {
  it('trims spaces and a trailing slash', () => {
    assert.equal(normalizeBaseUrl('  https://api.openai.com/v1/ '), 'https://api.openai.com/v1');
  });

  it('drops a pasted chat completions path', () => {
    assert.equal(
      normalizeBaseUrl('http://localhost:11434/v1/chat/completions'),
      'http://localhost:11434/v1',
    );
    assert.equal(
      normalizeBaseUrl('https://api.anthropic.com/v1/chat/completions/'),
      'https://api.anthropic.com/v1',
    );
  });

  it('keeps an address without a path as it is', () => {
    assert.equal(normalizeBaseUrl('https://llm.example.com'), 'https://llm.example.com');
  });
});

describe('aiFormErrors', () => {
  const valid = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };

  it('accepts an http or https address and a model', () => {
    assert.deepEqual(aiFormErrors(valid), {});
    assert.deepEqual(aiFormErrors({ ...valid, baseUrl: 'http://localhost:11434/v1' }), {});
  });

  it('needs an address', () => {
    assert.equal(aiFormErrors({ ...valid, baseUrl: '  ' }).baseUrl, 'Enter the endpoint address');
  });

  it('refuses an address that is not http or https', () => {
    assert.equal(
      aiFormErrors({ ...valid, baseUrl: 'ftp://llm.example.com' }).baseUrl,
      'Use an http or https address',
    );
    assert.equal(
      aiFormErrors({ ...valid, baseUrl: 'not a url' }).baseUrl,
      'Use an http or https address',
    );
  });

  it('needs a model', () => {
    assert.equal(aiFormErrors({ ...valid, model: ' ' }).model, 'Enter the model name');
  });
});
