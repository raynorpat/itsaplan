import { useState } from 'react';
import Link from 'next/link';
import { Link2, X } from 'lucide-react';
import { RELATION_KIND_LABEL } from '../../utils/relations';
import { issuePathFromIdentifier } from '@/utils/issueNavigation';
import {
  useCreateRelation,
  useDeleteRelation,
  useIssueRelationsQuery,
} from '../../services/relations.service';
import IssueRelationPicker from './IssueRelationPicker';

// The issue's relations as compact rows, in Linear's group order: blocked by,
// blocks, related, duplicate of, duplicated by; each row names its kind. Adding and
// removing are offered only to someone who can edit the issue; the API enforces the
// same rule.
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
    <div className="mt-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
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

      {groups.length > 0 && (
        <ul className="flex flex-col">
          {groups.flatMap((g) =>
            g.items.map((it) => (
              <li
                key={it.relationId}
                className="group flex h-8 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-accent/50"
              >
                <span className="w-24 shrink-0 text-xs text-muted-foreground">
                  {RELATION_KIND_LABEL[g.kind]}
                </span>
                <Link
                  href={issuePathFromIdentifier(it.issue.identifier)}
                  className="flex min-w-0 flex-1 items-center gap-2"
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
            )),
          )}
        </ul>
      )}
    </div>
  );
}
