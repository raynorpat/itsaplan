'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import BrandPanel from '@/components/common/page/BrandPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { followRedirect, resumeAuthorization } from './services/consent.service';

// Where a sign-in that started from an OAuth authorization lands (/oauth/resume): it
// hands the signed authorization query back to the OAuth provider, which continues
// with the new session (the consent page, or straight back to the application when
// it was allowed before).
export default function OAuthResumePage() {
  const params = useSearchParams();
  const oauthQuery = params.toString();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    resumeAuthorization(oauthQuery)
      .then(followRedirect)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'The authorization could not continue.'),
      );
  }, [oauthQuery]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-4xl">
        <Card className="overflow-hidden p-0">
          <CardContent className="grid p-0 md:grid-cols-2">
            <div className="flex flex-col gap-4 p-6 md:p-8">
              {error ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {error} The link may have expired; start again from the application.
                  </p>
                  <Button asChild variant="outline">
                    <Link href="/">Go to the workspace</Link>
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Continuing…</p>
              )}
            </div>
            <BrandPanel subtitle="An application is asking for access to this workspace." />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
