import { Elysia, t } from 'elysia';
import { workerTokenValid } from '../shared/http';
import { sendDelivery } from './send';

// Internal endpoint the worker calls to deliver one claimed notification_delivery
// row. The instance email credentials are encrypted at rest, so the send runs here
// (in the API, which owns the encryption key) rather than in the worker.
// Authenticated with the shared WORKER_INTERNAL_TOKEN. Returns the SendResult so the
// worker records the outcome and decides whether to retry.
const sendBody = t.Object({
  teamId: t.String({ format: 'uuid' }),
  channel: t.Literal('email'),
  recipient: t.Nullable(t.String()),
  payload: t.Object({
    subject: t.Optional(t.String()),
    text: t.String(),
    url: t.Optional(t.String()),
  }),
});

export const internalNotificationRoutes = new Elysia({
  name: 'internal-notification-deliveries',
}).post(
  '/internal/notification-deliveries/send',
  async ({ body, headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { ok: false, retryable: false, error: 'Unauthorized' };
    }
    return sendDelivery({ recipient: body.recipient, payload: body.payload });
  },
  { body: sendBody },
);
