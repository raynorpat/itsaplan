'use client';

import FullPageView from '@/components/common/page/FullPageView';
import AccountGoogleConnection from './components/accounts/AccountGoogleConnection';
import { useGoogleAvailable } from './services/accounts.service';

// A provider is only listed when the instance has it configured, so the page never
// offers a connection that cannot complete.
export default function AccountAccountsPage() {
  const googleAvailable = useGoogleAvailable();

  return (
    <FullPageView
      label="Accounts"
      title="Accounts"
      description="Connect external accounts to sign in with them."
    >
      <div className="divide-y">{googleAvailable && <AccountGoogleConnection />}</div>
    </FullPageView>
  );
}
