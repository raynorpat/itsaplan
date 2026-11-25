'use client';

import { useSession } from '@/lib/auth-client';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';
import SectionPageView from '@/components/common/page/SectionPageView';
import { useAiSettingsQuery } from './services/aiSettings.service';
import AiSettingsForm from './components/AiSettingsForm';

// Settings → Workspace → AI (/settings/workspace/ai): owners and admins set the
// OpenAI-compatible endpoint that writes the summaries requesters get. Without one the
// summaries are a plain round-up of the changes.
export default function AiSettingsPage() {
  const { data: session, isPending } = useSession();
  const isAdmin = isWorkspaceAdmin(toWorkspaceRole(session?.user.workspaceRole));
  const settings = useAiSettingsQuery(isAdmin);

  return (
    <SectionPageView
      title="AI"
      description="An OpenAI-compatible endpoint (OpenAI, Claude's OpenAI-compatible API, Ollama and others) that writes the summaries people who gave feedback receive. Without one, summaries list the changes."
    >
      {(isPending || (isAdmin && settings.isPending)) && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {!isPending && !isAdmin && (
        <p className="text-sm text-muted-foreground">
          Only workspace owners and admins can set up the AI endpoint.
        </p>
      )}
      {isAdmin && settings.data && (
        <AiSettingsForm key={settings.data.baseUrl ?? 'new'} settings={settings.data} />
      )}
    </SectionPageView>
  );
}
