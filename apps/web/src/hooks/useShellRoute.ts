import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { parseShellRoute, type ShellRoute } from '@/utils/shellRoute';

export type { ShellRoute } from '@/utils/shellRoute';

// The parts of the current route the Shell renders from. The open view, settings
// section and issue live in deeper segments than this layout, so they are read
// from the pathname rather than useParams.
export function useShellRoute(): ShellRoute {
  const params = useParams();
  const pathname = usePathname();
  const search = useSearchParams();
  const routeKey = params.teamKey;
  const teamKey = (Array.isArray(routeKey) ? routeKey[0] : routeKey) ?? null;
  return parseShellRoute(pathname, search.get('team'), teamKey);
}
