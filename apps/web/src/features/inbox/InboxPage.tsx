'use client';

import { useShell } from '@/context/shellContext';
import InboxView from './components/InboxView';

// The per-team inbox (/team/:teamKey/inbox): a list of the session user's
// notifications for this team on the left, the selected issue on the right.
export default function InboxPage() {
  const { team } = useShell();
  if (!team) return null;
  return <InboxView team={team} />;
}
