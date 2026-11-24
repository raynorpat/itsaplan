import { Badge } from '@/components/ui/badge';

// Marks an app user (an OAuth application installed with actor=app) next to its name,
// as Linear does, so its comments and changes are not read as a person's. A workflow's
// comment uses the same badge with the label "Workflow".
export default function AppBadge({ label = 'App' }: { label?: string }) {
  return (
    <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4">
      {label}
    </Badge>
  );
}
