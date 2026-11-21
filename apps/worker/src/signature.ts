import { createHmac } from 'node:crypto';

// Linear's webhook signature: the hex HMAC-SHA256 of the raw request body, keyed
// with the webhook's secret, sent as Linear-Signature. The receiver recomputes it
// over the exact bytes it received and compares in constant time; replay is
// checked against the body's webhookTimestamp.
export function signBody(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}
