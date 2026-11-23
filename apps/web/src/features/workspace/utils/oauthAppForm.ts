// The OAuth application form and the body the instance plugin's create and update
// endpoints take (apps/api src/oauth/apps.ts).

export interface OAuthAppForm {
  name: string;
  description: string;
  developer: string;
  developerUrl: string;
  iconUrl: string;
  // One redirect URI per line.
  redirectUris: string;
  publicClient: boolean;
  clientCredentials: boolean;
  webhookUrl: string;
  webhookResourceTypes: string[];
}

export function emptyAppForm(): OAuthAppForm {
  return {
    name: '',
    description: '',
    developer: '',
    developerUrl: '',
    iconUrl: '',
    redirectUris: '',
    publicClient: false,
    clientCredentials: false,
    webhookUrl: '',
    webhookResourceTypes: [],
  };
}

export interface OAuthAppInput {
  name: string;
  description: string | null;
  developer: string | null;
  developerUrl: string | null;
  iconUrl: string | null;
  redirectUris: string[];
  publicClient: boolean;
  clientCredentials: boolean;
  webhookUrl: string | null;
  webhookResourceTypes?: string[];
}

const orNull = (value: string) => value.trim() || null;

export function appFormInput(form: OAuthAppForm): OAuthAppInput {
  const webhookUrl = orNull(form.webhookUrl);
  return {
    name: form.name.trim(),
    description: orNull(form.description),
    developer: orNull(form.developer),
    developerUrl: orNull(form.developerUrl),
    iconUrl: orNull(form.iconUrl),
    redirectUris: form.redirectUris
      .split('\n')
      .map((uri) => uri.trim())
      .filter(Boolean),
    publicClient: form.publicClient,
    clientCredentials: form.clientCredentials,
    webhookUrl,
    ...(webhookUrl ? { webhookResourceTypes: form.webhookResourceTypes } : {}),
  };
}
