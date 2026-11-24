import { Suspense } from 'react';
import PortalSignInPage from '@/features/portal/PortalSignInPage';

// The sign-in page reads ?token= in the browser, inside Suspense as Next requires.
export default function Page() {
  return (
    <Suspense>
      <PortalSignInPage />
    </Suspense>
  );
}
