// The Settings area's "Back to app" returns to the last page the user had open
// outside Settings, kept in sessionStorage for the tab.
export const LAST_APP_PATH_KEY = 'lastAppPath';

export function isAppPath(pathname: string): boolean {
  return pathname !== '/settings' && !pathname.startsWith('/settings/');
}

// The remembered page, when it is a same-origin path outside Settings; else the start page.
export function backToAppHref(stored: string | null): string {
  if (!stored || !stored.startsWith('/') || stored.startsWith('//')) return '/';
  const pathname = stored.split('?')[0]!;
  return isAppPath(pathname) ? stored : '/';
}
