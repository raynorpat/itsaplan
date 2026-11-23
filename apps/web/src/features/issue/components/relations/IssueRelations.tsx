import { useState } from 'react';
import Link from 'next/link';
import { Link2, X } from 'lucide-react';
import { RELATION_KIND_LABEL } from '../../utils/relations';
import { issuePath } from '@/utils/paths';
import {
  useCreateRelation,
  useDeleteRelation,
  useIssueRelationsQuery,
} from '../../services/relations.service';
import IssueRelationPicker from './IssueRelationPicker';

// "MKT-42" → the issue page path.
function pathOf(identifier: string): string {
  const cut = identifier.lastIndexOf('-');
  return issuePath(identifier.slice(0, cut), Number(identifier.slice(cut + 1)));
}

// The issue's relations, grouped as Linear shows them: blocked by, blocks, related,
// duplicate of, duplicated by. Adding and removing are offered only to someone who
// can edit the issue; the API enforces the same rule.
export default function IssueRelations({
  issueId,
  teamKey,
  canEdit,
}: {
  issueId: string;
  teamKey: string;
  canEdit: boolean;
}) {
  const groups = useIssueRelationsQuery(issueId).data ?? [];
  const create = useCreateRelation(issueId, teamKey);
  const remove = useDeleteRelation(issueId, teamKey);
  const [error, setError] = useState<string | null>(null);

  if (groups.length === 0 && !canEdit) return null;

  return (
    <div className="mt-6 border-t pt-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Link2 className="size-3.5" />
          Relations
        </h3>
        {canEdit && (
          <IssueRelationPicker
            issueId={issueId}
            pending={create.isPending}
            onPick={(kind, otherId) => {
              setError(null);
              create.mutate(
                { kind, otherId },
                { onError: (err) => setError(err instanceof Error ? err.message : 'Failed') },
              );
            }}
          />
        )}
      </div>

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No related issues.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.kind}>
              <div className="mb-1 text-xs text-muted-foreground">
                {RELATION_KIND_LABEL[g.kind]}
              </div>
              <ul className="flex flex-col gap-1">
                {g.items.map((it) => (
                  <li key={it.relationId} className="group flex items-center gap-2 text-sm">
                    <Link
                      href={pathOf(it.issue.identifier)}
                      className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
                    >
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {it.issue.identifier}
                      </span>
                      <span className="truncate">{it.issue.title}</span>
                    </Link>
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Remove relation to ${it.issue.identifier}`}
                        className="text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                        onClick={() => remove.mutate(it.relationId)}
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
