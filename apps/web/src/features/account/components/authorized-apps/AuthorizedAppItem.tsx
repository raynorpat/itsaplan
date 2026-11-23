import { Unplug } from 'lucide-react';
import AppIcon from '@/components/common/AppIcon';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { formatShortDate } from '@/utils/dates';
import { describeScopes } from '@/utils/oauthScopes';
import type { AuthorizedApp } from '../../services/authorizedApps.service';

export default function AuthorizedAppItem({
  app,
  onRevoke,
}: {
  app: AuthorizedApp;
  onRevoke: () => void;
}) {
  const scopes = describeScopes(app.scopes)
    .map((s) => s.scope)
    .join(', ');
  return (
    <Item
      size="sm"
      className="rounded-none border-0 border-b border-border px-1 last:border-b-0 hover:bg-accent/50"
    >
      <ItemMedia>
        <AppIcon name={app.name} iconUrl={app.iconUrl} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{app.name}</ItemTitle>
        <ItemDescription>
          {app.developer && `${app.developer} · `}
          {scopes} · Authorized {formatShortDate(app.authorizedAt)}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="sm" onClick={onRevoke}>
          <Unplug />
          Revoke
        </Button>
      </ItemActions>
    </Item>
  );
}
