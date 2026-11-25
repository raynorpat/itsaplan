'use client';

import { useParams } from 'next/navigation';
import { useShell } from '@/context/shellContext';
import { useRelease } from '@/services/releases.service';
import ReleaseDescription from './components/release/ReleaseDescription';
import ReleaseDocuments from './components/release/ReleaseDocuments';
import ReleaseHeader from './components/release/ReleaseHeader';
import ReleaseIssues from './components/release/ReleaseIssues';
import ReleaseLinks from './components/release/ReleaseLinks';
import ReleaseNotes from './components/release/ReleaseNotes';
import ReleaseNotFound from './components/ReleaseNotFound';
import { useCanEditReleases } from './hooks/useCanEditReleases';

const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

// One release: its header (name, stage, dates, progress, actions), description, issues
// by state, release notes, and the links and documents CI synced.
export default function ReleasePage() {
  const { team } = useShell();
  const params = useParams();
  const query = useRelease(param(params.releaseSlug));
  const canEdit = useCanEditReleases();

  if (!team) return null;
  const release = query.data;
  if (!release) return <ReleaseNotFound loading={query.isLoading} what="Release" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <ReleaseHeader key={release.id} release={release} teamKey={team.team.key} canEdit={canEdit} />
      <div className="flex flex-col gap-6 pb-8">
        <ReleaseDescription
          key={`d-${release.id}`}
          releaseId={release.id}
          description={release.description}
          canEdit={canEdit}
        />
        <ReleaseIssues releaseId={release.id} issues={release.issues} canEdit={canEdit} />
        <ReleaseNotes release={release} canEdit={canEdit} />
        <ReleaseLinks links={release.links} />
        <ReleaseDocuments documents={release.documents} />
      </div>
    </div>
  );
}
