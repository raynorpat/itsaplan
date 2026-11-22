import { sendEmail, emailBody, type SendResult } from '@repo/mailer';
import { getNotificationEmailConfig } from '@repo/auth';
import type { DeliveryPayload } from './outbound';

// Sends one composed notification email through the instance email provider. Email
// transport lives in @repo/mailer (shared with the authentication mail sent from
// @repo/auth). The result tells the worker whether a failure is worth retrying
// (transient: network error, timeout, rate limit, server error) or permanent (bad
// credentials, rejected recipient, no provider configured).

export type { SendResult };

export interface SendInput {
  recipient: string | null;
  payload: DeliveryPayload;
}

export async function sendDelivery(input: SendInput): Promise<SendResult> {
  if (!input.recipient) return { ok: false, retryable: false, error: 'no recipient' };
  const config = await getNotificationEmailConfig();
  if (!config) return { ok: false, retryable: false, error: 'email not configured' };
  const { text, html } = emailBody(input.payload.text, input.payload.url);
  return sendEmail(config, {
    to: input.recipient,
    subject: input.payload.subject ?? '',
    text,
    html,
  });
}
