'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import SettingsCard from '@/components/common/page/SettingsCard';
import type { OrganizationSettings } from '../services/organization.service';
import { useUpdateOrganization } from '../services/organization.service';

// The workspace name, URL key and logo. Saved together with one button.
export default function WorkspaceGeneralForm({ org }: { org: OrganizationSettings }) {
  const [name, setName] = useState(org.name);
  const [urlKey, setUrlKey] = useState(org.urlKey);
  const [logoUrl, setLogoUrl] = useState(org.logoUrl ?? '');
  const update = useUpdateOrganization();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate({ name: name.trim(), urlKey: urlKey.trim(), logoUrl: logoUrl.trim() || null });
  }

  return (
    <SettingsCard className="p-4">
      <form onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="org-name">Name</FieldLabel>
            <Input id="org-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="org-url-key">URL key</FieldLabel>
            <Input
              id="org-url-key"
              required
              pattern="[a-z0-9][a-z0-9-]*"
              value={urlKey}
              onChange={(e) => setUrlKey(e.target.value)}
            />
            <FieldDescription>Lowercase letters, digits and dashes.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="org-logo">Logo URL</FieldLabel>
            <Input
              id="org-logo"
              type="url"
              placeholder="https://…"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
            />
          </Field>
          <Field>
            <Button type="submit" disabled={update.isPending} className="w-fit">
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </SettingsCard>
  );
}
