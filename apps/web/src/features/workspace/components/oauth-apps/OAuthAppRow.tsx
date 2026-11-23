'use client';

import { Archive, KeyRound, MoreHorizontal, Pencil, Unplug, Webhook } from 'lucide-react';
import AppIcon from '@/components/common/AppIcon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { describeScopes } from '@/utils/oauthScopes';
import type { OAuthApp } from '../../services/oauthApps.service';

export type OAuthAppAction =
  'edit' | 'rotate-secret' | 'rotate-webhook-secret' | 'uninstall' | 'archive';

// The teams an installed app may use, in a few words.
function installSummary(app: OAuthApp): string {
  const install = app.installation!;
  const parts: string[] = [];
  if (install.publicTeams) parts.push('every public team');
  if (install.teamIds.length)
    parts.push(`${install.teamIds.length} ${install.teamIds.length === 1 ? 'team' : 'teams'}`);
  const scopes = describeScopes(install.scopes)
    .map((s) => s.scope)
    .join(', ');
  return `Installed as an app · ${parts.join(' and ') || 'no teams'} · ${scopes}`;
}

export default function OAuthAppRow({
  app,
  onAction,
}: {
  app: OAuthApp;
  onAction: (action: OAuthAppAction) => void;
}) {
  return (
    <Item
      size="sm"
      className="rounded-none border-0 border-b border-border px-1 last:border-b-0 hover:bg-accent/50"
    >
      <ItemMedia>
        <AppIcon name={app.name} iconUrl={app.iconUrl} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {app.name}
          {app.archived && <Badge variant="outline">Archived</Badge>}
          {app.publicClient && <Badge variant="outline">Public client</Badge>}
        </ItemTitle>
        <ItemDescription>
          <span className="font-mono">{app.clientId}</span>
          {app.installation && <> · {installSummary(app)}</>}
        </ItemDescription>
      </ItemContent>
      {!app.archived && (
        <ItemActions>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                title="More actions"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onAction('edit')}>
                <Pencil />
                Edit application
              </DropdownMenuItem>
              {!app.publicClient && (
                <DropdownMenuItem onSelect={() => onAction('rotate-secret')}>
                  <KeyRound />
                  Rotate client secret
                </DropdownMenuItem>
              )}
              {app.webhookUrl && (
                <DropdownMenuItem onSelect={() => onAction('rotate-webhook-secret')}>
                  <Webhook />
                  Rotate webhook secret
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {app.installation && (
                <DropdownMenuItem variant="destructive" onSelect={() => onAction('uninstall')}>
                  <Unplug />
                  Uninstall
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={() => onAction('archive')}>
                <Archive />
                Archive application
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ItemActions>
      )}
    </Item>
  );
}
