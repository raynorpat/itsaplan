// Posts to the API's /internal/* routes. The worker owns the queues, the API owns
// the credentials and the actual send, so every outbound job goes through here.
// The api origin is SERVICE_URL_API in the compose stack (Coolify sets it) and
// API_URL locally.
export async function postInternal(
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  const token = process.env.WORKER_INTERNAL_TOKEN;
  if (!token) throw new Error('WORKER_INTERNAL_TOKEN is required');
  const baseUrl = process.env.SERVICE_URL_API ?? process.env.API_URL;
  if (!baseUrl) throw new Error('SERVICE_URL_API or API_URL is required');
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-worker-token': token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// Reports issues the auto-archive sweep archived, so the api sends their webhook
// events. Batched: the first sweep of an instance can archive thousands of issues.
export async function notifyIssuesArchived(
  issues: { id: string; previousUpdatedAt: string }[],
): Promise<void> {
  for (let from = 0; from < issues.length; from += 200) {
    const response = await postInternal(
      '/internal/webhooks/issues-archived',
      { issues: issues.slice(from, from + 200) },
      30_000,
    );
    if (!response.ok) throw new Error(`Webhook API returned ${response.status}`);
  }
}

// Runs the cycle upkeep in the api: it closes ended cycles with rollover, creates
// upcoming cycles and appends cycle history, through the stores.
export async function runCycleUpkeep(): Promise<void> {
  const response = await postInternal('/internal/cycles/tick', {}, 120_000);
  if (!response.ok) throw new Error(`Cycle API returned ${response.status}`);
}

// Deletes uploads (Linear's fileUpload) that no attachment or avatar used within a
// day, in the api, which holds the object-store credentials.
export async function runUploadCleanup(): Promise<number> {
  const response = await postInternal('/internal/uploads/cleanup', {}, 60_000);
  if (!response.ok) throw new Error(`Upload cleanup API returned ${response.status}`);
  const body = (await response.json()) as { removed?: number };
  return body.removed ?? 0;
}

// Deletes projects that have been in the trash longer than the API's trash period.
export async function runProjectPurge(): Promise<number> {
  const response = await postInternal('/internal/projects/purge', {}, 60_000);
  if (!response.ok) throw new Error(`Project purge API returned ${response.status}`);
  const body = (await response.json()) as { removed?: number };
  return body.removed ?? 0;
}
