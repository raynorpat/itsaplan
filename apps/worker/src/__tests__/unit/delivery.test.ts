import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { deliver, nextRetryDelayS, renderBody } from '../../delivery';

// A receiver written the way Linear documents webhook verification: the HMAC of
// the raw body in Linear-Signature, and webhookTimestamp within a minute.
// https://linear.app/developers/webhooks
const SECRET = 'whsec_receiver';
let status = 200;
let delayMs = 0;
let lastHeaders: Headers | null = null;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (delayMs) await Bun.sleep(delayMs);
    lastHeaders = req.headers;
    const raw = Buffer.from(await req.arrayBuffer());
    const expected = createHmac('sha256', SECRET).update(raw).digest();
    const given = Buffer.from(req.headers.get('linear-signature') ?? '', 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return new Response('bad signature', { status: 400 });
    const body = JSON.parse(raw.toString('utf8'));
    if (Math.abs(Date.now() - body.webhookTimestamp) > 60_000)
      return new Response('stale', { status: 400 });
    return new Response('ok', { status });
  },
});

const url = `http://localhost:${server.port}/hook`;
const payload = { action: 'create', type: 'Issue', data: { id: 'x' } };

function send(timeoutMs = 5000) {
  return deliver({
    url,
    secret: SECRET,
    eventId: 'evt-1',
    eventType: 'Issue',
    sentAt: Date.now(),
    body: renderBody(payload, Date.now()),
    timeoutMs,
  });
}

describe('deliver', () => {
  beforeAll(() => {
    status = 200;
  });
  afterAll(() => {
    server.stop(true);
  });

  it('is accepted by a receiver that verifies like Linear', async () => {
    status = 200;
    const result = await send();
    expect(result.ok).toBe(true);
    expect(lastHeaders!.get('linear-event')).toBe('Issue');
    expect(lastHeaders!.get('linear-delivery')).toBe('evt-1');
    expect(Number(lastHeaders!.get('linear-timestamp'))).toBeGreaterThan(Date.now() - 60_000);
    expect(lastHeaders!.get('user-agent')).toBe('Linear-Webhook');
    expect(lastHeaders!.get('content-type')).toBe('application/json; charset=utf-8');
  });

  it('counts a non-200 success status as a failure', async () => {
    status = 201;
    const result = await send();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(201);
    status = 200;
  });

  it('times out a slow receiver', async () => {
    delayMs = 300;
    const result = await send(100);
    expect(result.ok).toBe(false);
    delayMs = 0;
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
