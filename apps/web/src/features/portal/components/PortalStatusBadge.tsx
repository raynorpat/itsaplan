import { Badge } from '@/components/ui/badge';
import { statusLabel, type PublicStatus } from '../utils/portal';

export default function PortalStatusBadge({
  status,
  underReview,
}: {
  status: PublicStatus;
  underReview?: boolean;
}) {
  return (
    <Badge variant="secondary" className="font-normal">
      {underReview ? 'Under review' : statusLabel(status)}
    </Badge>
  );
}
