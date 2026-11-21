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
// events. Batched like deleteIssueAgentThreads: the first sweep of an instance can
// archive thousands of issues.
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
