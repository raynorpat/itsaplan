import { aiSettings, db } from '@repo/db';
import { getActiveSession } from '@repo/auth';
import type { AiHandlers } from '@repo/auth';
import { eq } from 'drizzle-orm';
import { assertWorkspaceRole } from '../shared/access';
import { HttpError } from '../shared/lib';
import { open, seal } from '../shared/secret-box';
import type { Change } from './changes';

// The instance's AI endpoint for requester summaries (spec: requester updates): an
// OpenAI-compatible chat completions server (OpenAI, Claude's OpenAI-compatible API,
// Ollama, …) set up by owners and admins through /api/auth/instance/ai*. The API key is
// sealed at rest and never returned. A summary sends the model only the Change fields
// the person may see (titles, public statuses, their portal threads' replies, shared
// project updates); any error, an unusable reply or 20 seconds without an answer gives
// null, and the caller uses the round-up alone.

const TIMEOUT_MS = 20_000;
const MAX_REPLY = 2_000;
const MAX_MODEL = 200;
const MAX_URL = 2_000;
const MAX_KEY = 1_000;
const ROW_ID = 'instance';

interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

async function storedRow() {
  const [row] = await db.select().from(aiSettings).where(eq(aiSettings.id, ROW_ID));
  return row ?? null;
}

async function config(): Promise<AiConfig | null> {
  const row = await storedRow();
  if (!row) return null;
  try {
    return { baseUrl: row.baseUrl, model: row.model, apiKey: open(row.apiKeyCiphertext) };
  } catch {
    // Sealed under another BETTER_AUTH_SECRET: unusable until saved again.
    console.error('[updates] the stored AI key cannot be opened; save it again in Settings');
    return null;
  }
}

const STATUS_LABEL: Record<string, string> = {
  underReview: 'Under review',
  planned: 'Planned',
  inProgress: 'In progress',
  done: 'Done',
  closed: 'Closed',
};

const HEALTH_LABEL: Record<string, string> = {
  onTrack: 'On track',
  atRisk: 'At risk',
  offTrack: 'Off track',
};

// What the model is told about each change: only facts the person may see.
function facts(change: Change): Record<string, unknown> {
  switch (change.kind) {
    case 'status':
      return {
        type: 'status change',
        issue: change.title,
        from: change.from ? STATUS_LABEL[change.from] : null,
        to: STATUS_LABEL[change.to],
        duplicateOf: change.duplicateOf?.title ?? null,
      };
    case 'reply':
      return { type: 'reply', issue: change.title, author: change.author, text: change.body };
    case 'projectUpdate':
      return {
        type: 'project update',
        project: change.projectName,
        health: change.health ? HEALTH_LABEL[change.health] : null,
        text: change.body,
      };
  }
}

const SYSTEM_PROMPT =
  'You write short email summaries for people who asked a software team for features ' +
  'or fixes. From the list of changes you are given, write 2 to 4 plain sentences in ' +
  'English telling the reader what happened. Use only the facts in the list; do not ' +
  'invent dates, plans or reasons. No Markdown, no lists, no greeting and no sign-off.';

async function complete(
  cfg: AiConfig,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response> {
  return fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, ...body }),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function replyText(json: unknown): string | null {
  const content = (json as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;
  if (typeof content !== 'string') return null;
  const text = content.trim();
  return text.length >= 1 && text.length <= MAX_REPLY ? text : null;
}

// Whether an AI endpoint is set up (the key may still fail to open).
export async function aiConfigured(): Promise<boolean> {
  return (await storedRow()) !== null;
}

// A paragraph summing up `changes` for the person, or null (no endpoint, an error, an
// unusable reply, or no answer within the timeout).
export async function aiSummary(
  changes: Change[],
  person: { displayName: string },
  options: { timeoutMs?: number } = {},
): Promise<string | null> {
  if (changes.length === 0) return null;
  const cfg = await config();
  if (!cfg) return null;
  try {
    const res = await complete(
      cfg,
      {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({ reader: person.displayName, changes: changes.map(facts) }),
          },
        ],
        max_tokens: 400,
        temperature: 0.3,
      },
      options.timeoutMs ?? TIMEOUT_MS,
    );
    if (!res.ok) {
      console.error(`[updates] the AI endpoint answered ${res.status}`);
      return null;
    }
    return replyText(await res.json());
  } catch (error) {
    console.error('[updates] the AI endpoint failed:', (error as Error).message);
    return null;
  }
}

// --- Settings (instance endpoints) -------------------------------------------------

export interface AiSettingsDto {
  baseUrl: string | null;
  model: string | null;
  hasKey: boolean;
}

async function admin(headers: Headers) {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return assertWorkspaceRole(session.user, 'admin');
}

const fields = (body: unknown): Record<string, unknown> =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

// An http(s) address without a trailing slash; the chat completions path is added to it.
function cleanBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_URL)
    throw new HttpError(400, 'baseUrl must be an http or https address');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, 'baseUrl must be an http or https address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new HttpError(400, 'baseUrl must be an http or https address');
  if (url.username || url.password || url.search || url.hash)
    throw new HttpError(400, 'baseUrl must not hold a user name, password or query string');
  return url.toString().replace(/\/+$/, '');
}

function cleanModel(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > MAX_MODEL)
    throw new HttpError(400, `model is required, at most ${MAX_MODEL} characters`);
  return value.trim();
}

async function getSettings(): Promise<AiSettingsDto> {
  const row = await storedRow();
  return row
    ? { baseUrl: row.baseUrl, model: row.model, hasKey: true }
    : { baseUrl: null, model: null, hasKey: false };
}

async function saveSettings(userId: string, body: Record<string, unknown>) {
  const baseUrl = cleanBaseUrl(body.baseUrl);
  const model = cleanModel(body.model);
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (apiKey.length > MAX_KEY) throw new HttpError(400, `apiKey is at most ${MAX_KEY} characters`);
  const stored = await storedRow();
  // An empty key keeps the stored one, but only for the same host: the key is never sent
  // to an address the admin did not enter it for.
  if (!apiKey && stored && new URL(stored.baseUrl).origin !== new URL(baseUrl).origin)
    throw new HttpError(400, 'Enter the API key again for a new address');
  const apiKeyCiphertext = apiKey ? seal(apiKey) : stored?.apiKeyCiphertext;
  if (!apiKeyCiphertext) throw new HttpError(400, 'apiKey is required');
  const values = { baseUrl, model, apiKeyCiphertext, updatedById: userId, updatedAt: new Date() };
  await db
    .insert(aiSettings)
    .values({ id: ROW_ID, ...values })
    .onConflictDoUpdate({ target: aiSettings.id, set: values });
  return getSettings();
}

// One short completion, to check the address, key and model.
async function testEndpoint(): Promise<{ ok: boolean; error?: string }> {
  const cfg = await config();
  if (!cfg) return { ok: false, error: 'No AI endpoint is set up' };
  try {
    const res = await complete(
      cfg,
      { messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 5 },
      TIMEOUT_MS,
    );
    if (!res.ok) return { ok: false, error: `The endpoint answered ${res.status}` };
    const json = (await res.json().catch(() => null)) as { choices?: unknown } | null;
    if (!Array.isArray(json?.choices))
      return { ok: false, error: 'The endpoint did not answer like a chat completions API' };
    return { ok: true };
  } catch (error) {
    const timedOut = (error as Error).name === 'TimeoutError';
    return {
      ok: false,
      error: timedOut
        ? 'The endpoint did not answer within 20 seconds'
        : 'The endpoint could not be reached',
    };
  }
}

export const aiHandlers: AiHandlers = {
  get: async (headers) => {
    await admin(headers);
    return getSettings();
  },
  save: async (headers, body) => saveSettings((await admin(headers)).id, fields(body)),
  remove: async (headers) => {
    await admin(headers);
    await db.delete(aiSettings).where(eq(aiSettings.id, ROW_ID));
    return getSettings();
  },
  test: async (headers) => {
    await admin(headers);
    return testEndpoint();
  },
};
