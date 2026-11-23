import { Suspense } from 'react';
import OAuthConsentPage from '@/features/oauth/OAuthConsentPage';

export default function Page() {
  return (
    <Suspense>
      <OAuthConsentPage />
    </Suspense>
  );
}
