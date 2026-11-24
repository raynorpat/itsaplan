'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { workspaceImportPath } from '@/utils/paths';
import { connectGithubImport } from './services/githubImport.service';
import { GITHUB_STATE_KEY, githubCallbackParams } from './utils/githubCallback';

// Where GitHub returns after the GitHub Import App is installed
// (/settings/workspace/import/github/callback): checks the state the Import page
// stored, connects the installation, and goes back to the Import page.
export default function GithubImportCallbackPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const stored = sessionStorage.getItem(GITHUB_STATE_KEY);
    sessionStorage.removeItem(GITHUB_STATE_KEY);
    const result = githubCallbackParams(new URLSearchParams(params.toString()), stored);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    connectGithubImport(result.code, result.installationId)
      .then(() => {
        toast.success('GitHub connected');
        router.replace(workspaceImportPath());
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'GitHub could not be connected.'),
      );
  }, [params, router]);

  return (
    <div className="flex flex-col items-start gap-4 p-8">
      {error ? (
        <>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={workspaceImportPath()}>Back to Import</Link>
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Connecting GitHub…</p>
      )}
    </div>
  );
}
