'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ConfirmEmailPage from '@/features/account/ConfirmEmailPage';

// The page an extra address's confirmation link opens (/confirm-email?token=). The
// token is read in the browser, inside Suspense as Next requires for search params.
function WithToken() {
  return <ConfirmEmailPage token={useSearchParams().get('token') ?? ''} />;
}

export default function Page() {
  return (
    <Suspense>
      <WithToken />
    </Suspense>
  );
}
