'use client';

import { useState, type FormEvent } from 'react';
import Modal from '@/components/common/overlay/Modal';
import { WebhookResourceTypes } from '@/components/common/WebhookResourceTypes';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { WebhookResourceType } from '@/services/webhooks.service';
import {
  useCreateOAuthApp,
  useUpdateOAuthApp,
  type OAuthApp,
  type OAuthAppSecrets,
} from '../../services/oauthApps.service';
import { appFormInput, emptyAppForm, type OAuthAppForm } from '../../utils/oauthAppForm';

function formOf(app: OAuthApp): OAuthAppForm {
  return {
    name: app.name,
    description: app.description ?? '',
    developer: app.developer ?? '',
    developerUrl: app.developerUrl ?? '',
    iconUrl: app.iconUrl ?? '',
    redirectUris: app.redirectUris.join('\n'),
    publicClient: app.publicClient,
    clientCredentials: app.clientCredentials,
    webhookUrl: app.webhookUrl ?? '',
    webhookResourceTypes: app.webhookResourceTypes,
  };
}

// Creates an OAuth application, or edits one. A new application's client id and
// secrets (and a newly added webhook's secret) are handed to `onSecrets`, which shows
// them once.
export default function OAuthAppDialog({
  app,
  onClose,
  onSecrets,
}: {
  app: OAuthApp | null;
  onClose: () => void;
  onSecrets: (clientId: string, secrets: OAuthAppSecrets) => void;
}) {
  const [form, setForm] = useState<OAuthAppForm>(app ? formOf(app) : emptyAppForm());
  const create = useCreateOAuthApp();
  const update = useUpdateOAuthApp();
  const pending = create.isPending || update.isPending;
  const set = <K extends keyof OAuthAppForm>(key: K, value: OAuthAppForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const input = appFormInput(form);
    if (app) {
      const result = await update.mutateAsync({ clientId: app.clientId, input });
      if (result.webhookSecret) onSecrets(app.clientId, { webhookSecret: result.webhookSecret });
      else onClose();
    } else {
      const result = await create.mutateAsync(input);
      onSecrets(result.application.clientId, {
        clientSecret: result.clientSecret,
        webhookSecret: result.webhookSecret,
      });
    }
  }

  const field = (id: keyof OAuthAppForm, label: string, placeholder?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`oauth-app-${id}`}>{label}</Label>
      <Input
        id={`oauth-app-${id}`}
        value={form[id] as string}
        placeholder={placeholder}
        onChange={(e) => set(id, e.target.value)}
        disabled={pending}
      />
    </div>
  );

  return (
    <Modal title={app ? 'Edit application' : 'New OAuth application'} onClose={onClose} wide>
      <form className="space-y-4" onSubmit={onSubmit}>
        {field('name', 'Name')}
        <div className="space-y-1.5">
          <Label htmlFor="oauth-app-description">Description</Label>
          <Textarea
            id="oauth-app-description"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('developer', 'Developer')}
          {field('developerUrl', 'Developer URL', 'https://')}
        </div>
        {field('iconUrl', 'Icon URL', 'https://')}
        <div className="space-y-1.5">
          <Label htmlFor="oauth-app-redirects">Callback URLs</Label>
          <Textarea
            id="oauth-app-redirects"
            value={form.redirectUris}
            placeholder="One URL per line"
            onChange={(e) => set('redirectUris', e.target.value)}
            disabled={pending}
          />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={form.publicClient}
            disabled={pending || !!app}
            onCheckedChange={(v) =>
              // A public client has no secret, so it cannot use client credentials.
              setForm((f) => ({
                ...f,
                publicClient: v === true,
                clientCredentials: v === true ? false : f.clientCredentials,
              }))
            }
          />
          <span>
            Public client (no client secret; PKCE required). For apps that run on a device or in a
            browser.{app && ' Fixed when the application was created.'}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={form.clientCredentials}
            disabled={pending || form.publicClient}
            onCheckedChange={(v) => set('clientCredentials', v === true)}
          />
          <span>
            Client credentials: once installed as an app, the application may get a token without a
            user present.
          </span>
        </label>
        {field('webhookUrl', 'Webhook URL', 'https://')}
        {form.webhookUrl.trim() && (
          <WebhookResourceTypes
            value={new Set(form.webhookResourceTypes as WebhookResourceType[])}
            onChange={(next) => set('webhookResourceTypes', [...next])}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={pending || !form.name.trim() || !form.redirectUris.trim()}
          >
            {app ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
