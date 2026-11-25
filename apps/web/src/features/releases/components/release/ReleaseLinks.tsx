import { ExternalLink } from 'lucide-react';
import type { ReleaseDetail } from '@/services/releases.service';
import ReleaseSection from '../ReleaseSection';

// The release's external links (build logs, changelogs) as CI synced them.
export default function ReleaseLinks({ links }: { links: ReleaseDetail['links'] }) {
  if (links.length === 0) return null;
  return (
    <ReleaseSection title="Links">
      <ul className="flex flex-col py-1">
        {links.map((l) => (
          <li key={l.id}>
            <a
              href={l.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-2 px-6 py-1.5 text-sm hover:bg-muted/50"
            >
              <ExternalLink aria-hidden className="size-3.5 text-muted-foreground" />
              <span className="truncate">{l.label || l.url}</span>
            </a>
          </li>
        ))}
      </ul>
    </ReleaseSection>
  );
}
