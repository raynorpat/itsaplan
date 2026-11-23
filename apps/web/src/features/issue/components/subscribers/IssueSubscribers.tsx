'use client';

import { Bell, BellOff } from 'lucide-react';
import { useSession } from '@/lib/auth-client';
import Avatar from '@/components/common/Avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isSubscribed, orderSubscribers } from '../../utils/subscribers';
import {
  useIssueSubscribersQuery,
  useToggleSubscription,
} from '../../services/subscribers.service';

// The issue's subscribers (who gets its comment and status notifications) and the
// viewer's Subscribe / Unsubscribe toggle.

export default function IssueSubscribers({ issueId }: { issueId: string }) {
  const { data: session } = useSession();
  const viewerId = session?.user.id ?? null;
  const subscribers = useIssueSubscribersQuery(issueId);
  const toggle = useToggleSubscription(issueId);
  const users = orderSubscribers(subscribers.data ?? [], viewerId);
  const subscribed = isSubscribed(users, viewerId);

  return (
    <div className="mt-3 flex items-center gap-2">
      {viewerId && (
        <Button
          variant="ghost"
          size="sm"
          disabled={toggle.isPending || subscribers.isLoading}
          onClick={() => toggle.mutate(!subscribed)}
        >
          {subscribed ? <BellOff className="size-4" /> : <Bell className="size-4" />}
          {subscribed ? 'Unsubscribe' : 'Subscribe'}
        </Button>
      )}
      <div className="flex -space-x-1">
        {users.map((u) => (
          <Tooltip key={u.id}>
            <TooltipTrigger asChild>
              <Avatar name={u.name} image={u.avatarUrl} className="ring-2 ring-background" />
            </TooltipTrigger>
            <TooltipContent>{u.id === viewerId ? `${u.name} (you)` : u.name}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
