import { type BulkIssuePatch, type TeamDetail } from '@/lib/api';
import {
  useBulkAddLabels,
  useBulkArchiveIssues,
  useBulkDeleteIssues,
  useBulkUpdateIssues,
} from '@/services/issues.service';

// Bulk operations over the selected issues, each a single request to the batch
// endpoints. The bar calls these with the current id set; cache updates and
// invalidation live in the mutations.
export function useBulkActions(team: TeamDetail) {
  const key = team.team.key;
  const update = useBulkUpdateIssues(key);
  const addLabels = useBulkAddLabels(key);
  const archive = useBulkArchiveIssues(key);
  const remove = useBulkDeleteIssues(key);

  return {
    patch: (ids: string[], patch: BulkIssuePatch) => update.mutateAsync({ ids, patch }),
    addLabel: (ids: string[], labelId: string) => addLabels.mutateAsync({ ids, add: [labelId] }),
    archiveAll: (ids: string[]) => archive.mutateAsync(ids),
    deleteAll: (ids: string[]) => remove.mutateAsync(ids),
    pending: update.isPending || addLabels.isPending || archive.isPending || remove.isPending,
  };
}
