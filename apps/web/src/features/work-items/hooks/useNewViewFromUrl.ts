import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

// Starts a new view when the URL asks for one (?new-view=1, the Views pages' New view
// link), then drops that parameter, keeping any others, so a reload does not start
// another. `ready` holds it until the team's issues and the viewer's rights are known.
export function useNewViewFromUrl(ready: boolean, canCreate: boolean, begin: () => void) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const asked = params.get('new-view') != null;
  useEffect(() => {
    if (!asked || !ready) return;
    if (canCreate) begin();
    else toast.info('You cannot create views in this team.');
    const rest = new URLSearchParams(params.toString());
    rest.delete('new-view');
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
    // `begin` is a fresh function each render; the request is handled once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, ready, canCreate]);
}
