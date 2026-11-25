import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSetPersonUpdates, type Person } from '../services/people.service';
import { personUpdatesHint } from '../utils/people';

// "Keep this person updated": emails about the issues they asked for. A person who
// unsubscribed can only turn this on again themselves, and one without an email gets
// nothing, so the switch is off and disabled for both.
export default function PersonUpdatesSwitch({ person }: { person: Person }) {
  const setUpdates = useSetPersonUpdates();
  const { enabled, unsubscribed } = person.updates;
  const locked = (unsubscribed && !enabled) || person.email == null;
  return (
    <div className="flex items-center gap-3 px-4 pb-3">
      <Switch
        id="person-updates"
        checked={enabled}
        disabled={locked || setUpdates.isPending}
        onCheckedChange={(checked) =>
          setUpdates.mutate({ requesterId: person.id, enabled: checked })
        }
      />
      <div className="grid gap-0.5">
        <Label htmlFor="person-updates">Keep this person updated</Label>
        <p className="text-xs text-muted-foreground">{personUpdatesHint(person)}</p>
      </div>
    </div>
  );
}
