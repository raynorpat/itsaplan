'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import BrandPanel from '@/components/common/page/BrandPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSession } from '@/lib/auth-client';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';
import { isAppInstall } from '@/utils/oauthScopes';
import { useConsent, useConsentClient } from './services/consent.service';
import { requestedScopes, type InstallSelection } from './utils/consent';
import OAuthAppHeader from './components/OAuthAppHeader';
import OAuthInstallTeams from './components/OAuthInstallTeams';
import OAuthScopeList from './components/OAuthScopeList';

// The OAuth consent step (/oauth/consent). The API's OAuth provider sends the browser
// here with its signed authorization query; Allow and Deny post that query back with
// the answer. An authorization with actor=app installs the application as an app
// user of the workspace, which only an admin or owner may do; they choose the teams it
// may use.
export default function OAuthConsentPage() {
  const params = useSearchParams();
  const oauthQuery = params.toString();
  const clientId = params.get('client_id');
  const scopes = requestedScopes(oauthQuery);
  const install = isAppInstall(scopes);

  const { data: session } = useSession();
  const isAdmin = isWorkspaceAdmin(toWorkspaceRole(session?.user.workspaceRole));
  const clientQuery = useConsentClient(clientId);
  const consent = useConsent();
  const [teams, setTeams] = useState<InstallSelection>({ publicTeams: true, teamIds: [] });

  const client = clientQuery.data;
  const answer = (accept: boolean) =>
    consent.mutate({ accept, oauthQuery, install: install ? teams : undefined });
  const canAllow = !install || isAdmin;

  let body = <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!clientId || clientQuery.isError) {
    body = (
      <p className="text-sm text-muted-foreground">
        This authorization link is invalid or the application no longer exists.
      </p>
    );
  } else if (client) {
    body = (
      <div className="flex flex-col gap-6">
        <OAuthAppHeader client={client} />

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">
            {install
              ? `${client.name} will be installed in the workspace as an app. It acts as its own user, not as you, and it will be able to:`
              : `${client.name} will act as you (${session?.user.email ?? '…'}) and will be able to:`}
          </p>
          <OAuthScopeList scopes={scopes} />
        </div>

        {install && isAdmin && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Teams it may use</p>
            <OAuthInstallTeams value={teams} onChange={setTeams} disabled={consent.isPending} />
          </div>
        )}
        {install && !isAdmin && (
          <p className="text-sm text-muted-foreground">
            Only workspace admins and owners can install applications.
          </p>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={consent.isPending}
            onClick={() => answer(false)}
          >
            Deny
          </Button>
          {canAllow && (
            <Button
              className="flex-1"
              disabled={
                consent.isPending || (install && !teams.publicTeams && !teams.teamIds.length)
              }
              onClick={() => answer(true)}
            >
              {install ? 'Install' : 'Allow'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-4xl">
        <Card className="overflow-hidden p-0">
          <CardContent className="grid p-0 md:grid-cols-2">
            <div className="p-6 md:p-8">{body}</div>
            <BrandPanel subtitle="An application is asking for access to this workspace." />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
