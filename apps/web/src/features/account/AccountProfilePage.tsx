'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth-client';
import SectionPageView from '@/components/common/page/SectionPageView';
import AccountProfileAvatar from './components/profile/AccountProfileAvatar';
import AccountProfileNameForm from './components/profile/AccountProfileNameForm';
import AccountSection from './components/AccountSection';

export default function AccountProfilePage() {
  const { data: session } = useSession();
  // The session can already be cached when React hydrates while the server rendered
  // without it; the email and the session-backed sections render after mount so the
  // first render matches the server's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const email = mounted ? session?.user.email : undefined;

  return (
    <SectionPageView
      title="Profile"
      description={`Your name and avatar are shown across the app. Signed in as ${email ?? '…'}.`}
    >
      {mounted && (
        <>
          <AccountSection
            title="Avatar"
            description="Shown next to your name in comments, assignees, and members."
          >
            <AccountProfileAvatar />
          </AccountSection>
          <AccountSection title="Name">
            <AccountProfileNameForm />
          </AccountSection>
        </>
      )}
    </SectionPageView>
  );
}
