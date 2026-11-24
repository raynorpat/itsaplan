'use client';

import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { instanceFetch } from '@/lib/auth-client';

// The page an extra address's confirmation link opens. It shows the address and
// confirms it only when the button is pressed, so a mail scanner that opens the link
// confirms nothing. Works without a session: the link's token is the credential.
export default function ConfirmEmailPage({ token }: { token: string }) {
  const info = useQuery({
    queryKey: ['confirm-email', token],
    queryFn: () =>
      instanceFetch<{ email: string }>(
        `/instance/account/emails/confirm-info?token=${encodeURIComponent(token)}`,
      ),
    enabled: token !== '',
    retry: false,
  });
  const confirm = useMutation({
    mutationFn: () =>
      instanceFetch<{ email: string }>('/instance/account/emails/confirm', {
        method: 'POST',
        body: { token },
      }),
    // The page shows the result; the app's global error toast is not needed.
    meta: { suppressErrorToast: true },
  });

  let body;
  if (!token || info.isError) {
    body = (
      <p className="text-sm text-muted-foreground">
        This link is not valid or has expired. Add the address again on your profile page to get a
        new link.
      </p>
    );
  } else if (info.isPending) {
    body = <p className="text-sm text-muted-foreground">Loading…</p>;
  } else if (confirm.isSuccess) {
    body = (
      <p className="text-sm">
        <span className="font-medium">{confirm.data.email}</span> is confirmed. It will be used to
        match you to your issues when someone imports them.
      </p>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Add <span className="font-medium">{info.data.email}</span> to your account? It is used
          only to match you to your issues in issue imports.
        </p>
        <Button disabled={confirm.isPending} onClick={() => confirm.mutate()}>
          {confirm.isPending ? 'Confirming…' : 'Confirm address'}
        </Button>
        {confirm.isError && <p className="text-sm text-destructive">{confirm.error.message}</p>}
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-6 p-6">
          <h1 className="text-xl font-semibold">Confirm your email address</h1>
          {body}
          <Button asChild variant="ghost" size="sm" className="self-start">
            <Link href="/settings/account/profile">Go to your profile</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
