import Link from 'next/link';
import { settingsPath } from '@/utils/paths';

// The team's Releases page before it has a pipeline.
export default function PipelinesEmpty({ teamKey }: { teamKey: string }) {
  return (
    <div className="px-6 py-8 text-sm text-muted-foreground">
      <p>No release pipelines yet.</p>
      <p className="mt-1">
        A pipeline tracks which issues ship in each release. Create one in{' '}
        <Link href={settingsPath(teamKey, 'releases')} className="underline underline-offset-2">
          team settings
        </Link>
        .
      </p>
    </div>
  );
}
