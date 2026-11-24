import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// Starts a new view when the URL asks for one (?new-view=1, the Views page's New view
// link), then drops the parameter so a reload does not start another. `ready` holds
// it until the team's issues are on screen.
export function useNewViewFromUrl(ready: boolean, canCreate: boolean, begin: () => void) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const asked = params.get('new-view') != null;
  useEffect(() => {
    if (!asked || !ready) return;
    if (canCreate) begin();
    router.replace(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, ready]);
}
