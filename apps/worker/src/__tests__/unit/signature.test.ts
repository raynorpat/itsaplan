import { describe, it, expect } from 'bun:test';
import { createHmac } from 'node:crypto';
import { signBody } from '../../signature';
import { nextRetryDelayS, renderBody } from '../../delivery';

describe('signBody', () => {
  it('is the hex HMAC-SHA256 of the raw body', () => {
    const body = JSON.stringify({ a: 1 });
    expect(signBody('whsec_test', body)).toBe(
      createHmac('sha256', 'whsec_test').update(body).digest('hex'),
    );
  });

  it('changes when the body or the secret changes', () => {
    expect(signBody('s', '{}')).not.toBe(signBody('s', '{ }'));
    expect(signBody('a', '{}')).not.toBe(signBody('b', '{}'));
  });
});

describe('renderBody', () => {
  it('sets a fresh webhookTimestamp on each attempt', () => {
    const payload = { action: 'create', type: 'Issue' };
    const a = JSON.parse(renderBody(payload, 1000));
    const b = JSON.parse(renderBody(payload, 2000));
    expect(a).toEqual({ ...payload, webhookTimestamp: 1000 });
    expect(b).toEqual({ ...payload, webhookTimestamp: 2000 });
  });
});

describe('nextRetryDelayS', () => {
  it("follows Linear's schedule: 1 minute, 1 hour, 6 hours, then final", () => {
    expect(nextRetryDelayS(1)).toBe(60);
    expect(nextRetryDelayS(2)).toBe(3600);
    expect(nextRetryDelayS(3)).toBe(21600);
    expect(nextRetryDelayS(4)).toBeNull();
  });
});
