import { Badge } from '@/components/ui/badge';

// Marks an app user (an OAuth application installed with actor=app) next to its name,
// as Linear does, so its comments and changes are not read as a person's.
export default function AppBadge() {
  return (
    <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4">
      App
    </Badge>
  );
}
