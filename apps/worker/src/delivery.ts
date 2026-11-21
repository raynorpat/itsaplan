import { signBody } from './signature';

export interface DeliverInput {
  url: string;
  secret: string;
  // Sent as Linear-Delivery; stable across retries so the receiver can deduplicate.
  eventId: string;
  // The Linear resource type, sent as Linear-Event.
  eventType: string;
  body: string;
  timeoutMs: number;
}

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
  // The receiver's response body, truncated. Absent on a network/timeout error.
  responseBody?: string;
}

// Response bodies are stored for the history view; cap what we keep.
const MAX_RESPONSE_CHARS = 2000;

// Linear retries a failed delivery 3 times, after 1 minute, 1 hour and 6 hours.
const RETRY_DELAYS_S = [60, 3600, 21600];

// Seconds until the next attempt after `attempts` failed attempts, or null when
// the delivery has failed for good.
export function nextRetryDelayS(attempts: number): number | null {
  return RETRY_DELAYS_S[attempts - 1] ?? null;
}

// The request body: the stored payload with webhookTimestamp set at send time, so
// a receiver's one-minute replay check passes on a retry hours later.
export function renderBody(payload: unknown, now: number): string {
  return JSON.stringify({ ...(payload as object), webhookTimestamp: now });
}

// Posts the signed payload with Linear's headers and a hard timeout. Only HTTP 200
// is success (Linear); any other status, a network error or the timeout fails the
// attempt.
export async function deliver(input: DeliverInput): Promise<DeliveryResult> {
  try {
    const res = await fetch(input.url, {
      method: 'POST',
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'Linear-Webhook',
        'Linear-Delivery': input.eventId,
        'Linear-Event': input.eventType,
        'Linear-Timestamp': String(Date.now()),
        'Linear-Signature': signBody(input.secret, input.body),
      },
      body: input.body,
    });
    const responseBody = (await res.text().catch(() => '')).slice(0, MAX_RESPONSE_CHARS);
    if (res.status === 200) return { ok: true, status: res.status, responseBody };
    return { ok: false, status: res.status, error: `HTTP ${res.status}`, responseBody };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'request failed' };
  }
}
