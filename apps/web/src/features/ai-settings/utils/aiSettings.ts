// Settings → Workspace → AI: the OpenAI-compatible endpoint form's checks.

export interface AiForm {
  baseUrl: string;
  model: string;
}

// The base URL the API adds `/chat/completions` to: without spaces, a trailing slash or
// a pasted `/chat/completions` path.
export function normalizeBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '');
}

export function aiFormErrors(form: AiForm): Record<string, string> {
  const errors: Record<string, string> = {};
  const baseUrl = normalizeBaseUrl(form.baseUrl);
  if (!baseUrl) errors.baseUrl = 'Enter the endpoint address';
  else if (!isHttpUrl(baseUrl)) errors.baseUrl = 'Use an http or https address';
  if (!form.model.trim()) errors.model = 'Enter the model name';
  return errors;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
