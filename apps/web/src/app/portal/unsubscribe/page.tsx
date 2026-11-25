import { Suspense } from 'react';
import PortalUnsubscribePage from '@/features/portal/PortalUnsubscribePage';

// The unsubscribe page reads ?token= in the browser, inside Suspense as Next requires.
export default function Page() {
  return (
    <Suspense>
      <PortalUnsubscribePage />
    </Suspense>
  );
}
