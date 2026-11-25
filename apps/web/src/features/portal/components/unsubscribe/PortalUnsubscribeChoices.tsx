'use client';

import { Button } from '@/components/ui/button';
import { useUnsubscribe } from '../../services/portal.service';
import { updatesSummary, type UpdatePrefs } from '../../utils/updates';
import PortalCadencePicker from '../PortalCadencePicker';

// The unsubscribe page's two choices: stop every email, or keep updates and only
// change how often the summary comes. Nothing changes until a button is pressed, so
// a mail scanner that opens the link changes nothing.
export default function PortalUnsubscribeChoices({
  token,
  prefs,
}: {
  token: string;
  prefs: UpdatePrefs;
}) {
  const unsubscribe = useUnsubscribe(token);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        You get: <span className="font-medium">{updatesSummary(prefs)}</span>
      </p>
      {prefs.enabled ? (
        <>
          <Button
            variant="destructive"
            disabled={unsubscribe.isPending}
            onClick={() => unsubscribe.mutate(undefined)}
          >
            Stop all emails
          </Button>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">
              Or keep updates and change the summary email:
            </span>
            <PortalCadencePicker
              value={prefs.summary}
              disabled={unsubscribe.isPending}
              onChange={(summary) => unsubscribe.mutate(summary)}
            />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          You won&apos;t get any more emails. To turn updates back on, sign in to the portal and
          open Email updates in your account menu.
        </p>
      )}
      {unsubscribe.error && (
        <p className="text-sm text-destructive" role="alert">
          {unsubscribe.error.message}
        </p>
      )}
    </div>
  );
}
