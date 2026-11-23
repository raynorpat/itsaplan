'use client';

import { Switch } from '@/components/ui/switch';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import type { OrganizationSettings } from '@/types/workspace';
import { useUpdateOrganization } from '../services/organization.service';

const SERVICES = [
  { key: 'email', title: 'Email link', description: 'A one-time link sent to the email.' },
  { key: 'google', title: 'Google', description: 'Needs the Google sign-in variables set.' },
  { key: 'passkey', title: 'Passkeys', description: 'Passkeys people added to their account.' },
] as const;

// Which sign-in methods the workspace allows. An empty list means all of them; turning
// one off writes the explicit list. An owner can always sign in with an email link.
export default function WorkspaceSignInMethods({ org }: { org: OrganizationSettings }) {
  const update = useUpdateOrganization();
  const allowed = org.allowedAuthServices.length
    ? org.allowedAuthServices
    : SERVICES.map((s) => s.key as string);

  function toggle(key: string, on: boolean) {
    const next = on ? [...new Set([...allowed, key])] : allowed.filter((s) => s !== key);
    // Every method on is the same as no restriction.
    update.mutate({ allowedAuthServices: next.length === SERVICES.length ? [] : next });
  }

  return (
    <SettingsCard className="divide-y divide-border/60">
      {SERVICES.map((s) => (
        <SettingsRow
          key={s.key}
          title={s.title}
          description={s.description}
          control={
            <Switch
              checked={allowed.includes(s.key)}
              disabled={update.isPending || (allowed.length === 1 && allowed.includes(s.key))}
              onCheckedChange={(on) => toggle(s.key, on)}
            />
          }
        />
      ))}
    </SettingsCard>
  );
}
