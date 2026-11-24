import { Suspense } from 'react';
import GithubImportCallbackPage from '@/features/imports/GithubImportCallbackPage';

export default function Page() {
  return (
    <Suspense>
      <GithubImportCallbackPage />
    </Suspense>
  );
}
