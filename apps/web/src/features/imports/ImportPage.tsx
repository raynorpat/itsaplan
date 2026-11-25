'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import { useTeamsQuery } from '@/services/teams.service';
import { useImportsQuery } from './services/imports.service';
import type { ImportView } from './utils/imports';
import NewImportForm from './components/NewImportForm';
import ImportRow from './components/ImportRow';
import ImportPeopleDialog from './components/ImportPeopleDialog';

// Settings → Workspace → Import (/settings/workspace/import): owners and admins bring
// issues from GitHub, GitLab, Gitea or Forgejo into a team once, as Linear's "Import
// issues" does, then follow each import in the list.
export default function ImportPage() {
  const { data: session, isPending } = useSession();
  const isAdmin = isWorkspaceAdmin(toWorkspaceRole(session?.user.workspaceRole));
  const imports = useImportsQuery(isAdmin);
  const teams = useTeamsQuery().data ?? [];
  const [matching, setMatching] = useState<ImportView | null>(null);
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? null;

  return (
    <SectionPageView
      title="Import"
      description="Bring the issues of a GitHub, GitLab, Gitea or Forgejo repository, a Jira export or any other CSV file into a team, with their labels and comments. Each import runs once; running it again skips issues already imported."
    >
      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isPending && !isAdmin && (
        <p className="text-sm text-muted-foreground">
          Only workspace owners and admins can import issues.
        </p>
      )}
      {isAdmin && (
        <div className="flex flex-col gap-10">
          <SettingsSection title="New import">
            <NewImportForm />
          </SettingsSection>
          <SettingsSection title="Imports">
            {imports.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
            {imports.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">No imports yet.</p>
            )}
            {imports.data && imports.data.length > 0 && (
              <SettingsCard className="divide-y divide-border/60">
                {imports.data.map((imp) => (
                  <ImportRow
                    key={imp.id}
                    imp={imp}
                    teamName={teamName(imp.teamId)}
                    onMatchPeople={() => setMatching(imp)}
                  />
                ))}
              </SettingsCard>
            )}
          </SettingsSection>
        </div>
      )}
      {matching && <ImportPeopleDialog imp={matching} onClose={() => setMatching(null)} />}
    </SectionPageView>
  );
}
