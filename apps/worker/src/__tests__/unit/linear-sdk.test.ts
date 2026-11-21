import { afterAll, describe, expect, it } from 'bun:test';
import { LinearWebhookClient } from '@linear/sdk/webhooks';
import { deliver, renderBody } from '../../delivery';

// A receiver built on @linear/sdk's own webhook client accepts a delivery: the
// end-to-end check that a Linear receiver works unchanged.
const SECRET = 'whsec_sdk';
const client = new LinearWebhookClient(SECRET);
let parsed: { type?: string; webhookTimestamp?: number } | null = null;
let headerTs: string | null = null;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const raw = Buffer.from(await req.arrayBuffer());
    headerTs = req.headers.get('linear-timestamp');
    try {
      parsed = client.parseData(raw, req.headers.get('linear-signature') ?? '');
      return new Response('ok');
    } catch {
      return new Response('rejected', { status: 400 });
    }
  },
});

describe('@linear/sdk receiver', () => {
  afterAll(() => {
    server.stop(true);
  });

  it('verifies and parses a delivery', async () => {
    const sentAt = Date.now();
    const result = await deliver({
      url: `http://localhost:${server.port}/hook`,
      secret: SECRET,
      eventId: 'evt',
      eventType: 'Issue',
      sentAt,
      body: renderBody({ action: 'create', type: 'Issue', data: { id: 'x' } }, sentAt),
      timeoutMs: 2000,
    });
    expect(result.ok).toBe(true);
    expect(parsed).toMatchObject({ type: 'Issue', webhookTimestamp: sentAt });
    // Linear-Timestamp and the body's webhookTimestamp are the same instant.
    expect(Number(headerTs)).toBe(sentAt);
  });
});
