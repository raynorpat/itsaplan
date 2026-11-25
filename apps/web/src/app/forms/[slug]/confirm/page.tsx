import { Suspense } from 'react';
import FormsConfirmPage from '@/features/forms/FormsConfirmPage';

// The confirm page reads ?token= in the browser, inside Suspense as Next requires.
export default function Page() {
  return (
    <Suspense>
      <FormsConfirmPage />
    </Suspense>
  );
}
