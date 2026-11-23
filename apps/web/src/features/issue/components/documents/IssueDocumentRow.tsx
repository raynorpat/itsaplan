import { FileText } from 'lucide-react';
import { documentTitle } from '../../utils/documents';
import { type IssueDocument } from '../../services/documents.service';

// One document in the issue's Documents list; clicking opens it.

export default function IssueDocumentRow({
  document,
  onOpen,
}: {
  document: IssueDocument;
  onOpen: () => void;
}) {
  const by = document.updatedBy?.name ?? document.creator?.name;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{documentTitle(document.title)}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {by ? `${by} · ` : ''}
          {new Date(document.updatedAt).toLocaleDateString()}
        </span>
      </button>
    </li>
  );
}
