import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { backToAppHref, isAppPath, LAST_APP_PATH_KEY } from '@/utils/lastAppPath';

// Remembers the current page while it is outside Settings, for "Back to app".
export function useRememberAppPath() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => {
    if (isAppPath(pathname))
      sessionStorage.setItem(LAST_APP_PATH_KEY, query ? `${pathname}?${query}` : pathname);
  }, [pathname, query]);
}

// Where "Back to app" leads. Read after mount: sessionStorage does not exist on the
// server, and the first render must match the server's.
export function useBackToAppHref(): string {
  const [href, setHref] = useState('/');
  useEffect(() => setHref(backToAppHref(sessionStorage.getItem(LAST_APP_PATH_KEY))), []);
  return href;
}
