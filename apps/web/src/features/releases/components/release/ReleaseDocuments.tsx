import DraftMarkdownEditor from '@/components/common/editor/DraftMarkdownEditor';
import type { ReleaseDetail } from '@/services/releases.service';
import ReleaseSection from '../ReleaseSection';

// The release's documents as CI synced them, each folded under its title.
export default function ReleaseDocuments({ documents }: { documents: ReleaseDetail['documents'] }) {
  if (documents.length === 0) return null;
  return (
    <ReleaseSection title="Documents">
      {documents.map((d) => (
        <details key={d.id} className="border-b px-6 py-2 last:border-b-0">
          <summary className="cursor-pointer text-sm font-medium">{d.title}</summary>
          <DraftMarkdownEditor value={d.content} editable={false} onSave={() => {}} />
        </details>
      ))}
    </ReleaseSection>
  );
}
