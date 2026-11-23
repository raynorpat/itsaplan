import AppIcon from '@/components/common/AppIcon';
import type { ConsentClient } from '../services/consent.service';

// The application asking for access: its icon, name, developer and description. A
// client an MCP client registered itself is marked as such: no admin vetted it.
export default function OAuthAppHeader({ client }: { client: ConsentClient }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <AppIcon name={client.name} iconUrl={client.iconUrl} className="size-12 text-base" />
      <h1 className="text-xl font-bold">{client.name}</h1>
      {client.developer && (
        <p className="text-sm text-muted-foreground">
          by{' '}
          {client.developerUrl ? (
            <a
              href={client.developerUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-4"
            >
              {client.developer}
            </a>
          ) : (
            client.developer
          )}
        </p>
      )}
      {client.description && (
        <p className="text-sm text-balance text-muted-foreground">{client.description}</p>
      )}
      {!client.application && (
        <p className="text-xs text-muted-foreground">
          This client registered itself (for example an AI tool connecting to the MCP server). No
          workspace admin added it.
        </p>
      )}
    </div>
  );
}
