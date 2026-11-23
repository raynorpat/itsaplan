'use client';

import InboxView from './components/InboxView';

// The workspace inbox (/inbox): the viewer's notifications from every team. Linear
// has one inbox for the workspace, not one per team.
export default function InboxPage() {
  return <InboxView />;
}
