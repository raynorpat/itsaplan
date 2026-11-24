import { Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSetPortalBlocked, type Person } from '../services/people.service';

// Block from portal / Unblock (owners and admins). Blocking asks first, since it signs
// the person out of every board.
export default function PersonPortalBlockButton({ person }: { person: Person }) {
  const setBlocked = useSetPortalBlocked();
  const blocked = person.portalBlocked;
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5"
      disabled={setBlocked.isPending}
      onClick={() => {
        if (
          !blocked &&
          !window.confirm(
            `Block ${person.name} from the portal? They are signed out of every board.`,
          )
        )
          return;
        setBlocked.mutate({ requesterId: person.id, blocked: !blocked });
      }}
    >
      <Ban className="size-3.5" />
      {blocked ? 'Unblock from portal' : 'Block from portal'}
    </Button>
  );
}
