import { afterAll, describe, expect, it } from 'bun:test';
import { deliver, renderBody } from '../../delivery';

// Linear accepts only a direct 200, and following a redirect would let a public
// URL point the worker at an internal address.
let internalHits = 0;
const internal = Bun.serve({
  port: 0,
  fetch() {
    internalHits++;
    return new Response('secret', { status: 200 });
  },
});
const redirector = Bun.serve({
  port: 0,
  fetch() {
    return Response.redirect(`http://localhost:${internal.port}/meta`, 302);
  },
});

describe('deliver and redirects', () => {
  afterAll(() => {
    internal.stop(true);
    redirector.stop(true);
  });

  it('does not follow a redirect and counts it as a failure', async () => {
    const result = await deliver({
      url: `http://localhost:${redirector.port}/hook`,
      secret: 's',
      eventId: 'e',
      eventType: 'Issue',
      sentAt: Date.now(),
      body: renderBody({}, Date.now()),
      timeoutMs: 2000,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(302);
    expect(internalHits).toBe(0);
  });
});
