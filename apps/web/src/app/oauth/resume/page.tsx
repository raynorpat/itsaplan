import { Suspense } from 'react';
import OAuthResumePage from '@/features/oauth/OAuthResumePage';

export default function Page() {
  return (
    <Suspense>
      <OAuthResumePage />
    </Suspense>
  );
}
