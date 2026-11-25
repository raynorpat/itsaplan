'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsCard from '@/components/common/page/SettingsCard';
import { Button } from '@/components/ui/button';
import { useFormsQuery, type FormDto } from './services/formsAdmin.service';
import FormRow from './components/FormRow';
import FormEditorDialog from './components/FormEditorDialog';

// Settings → Workspace → Forms (/settings/workspace/forms): owners and admins build
// the forms people outside the workspace fill in at /forms/<address> or on portal
// boards. Each confirmed submission becomes an issue with the person's feedback.
export default function FormsAdminPage() {
  const { data: session, isPending } = useSession();
  const isAdmin = isWorkspaceAdmin(toWorkspaceRole(session?.user.workspaceRole));
  const forms = useFormsQuery(isAdmin);
  // undefined: closed; null: a new form.
  const [editing, setEditing] = useState<FormDto | null | undefined>(undefined);

  return (
    <SectionPageView
      title="Forms"
      description="Forms people outside the workspace fill in to send requests. Each submission becomes an issue with their feedback."
    >
      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isPending && !isAdmin && (
        <p className="text-sm text-muted-foreground">
          Only workspace owners and admins can manage forms.
        </p>
      )}
      {isAdmin && (
        <div className="flex flex-col gap-4">
          <div>
            <Button size="sm" onClick={() => setEditing(null)}>
              New form
            </Button>
          </div>
          {forms.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {forms.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No forms yet.</p>
          )}
          {forms.data && forms.data.length > 0 && (
            <SettingsCard className="divide-y divide-border/60">
              {forms.data.map((f) => (
                <FormRow key={f.templateId} form={f} onEdit={() => setEditing(f)} />
              ))}
            </SettingsCard>
          )}
        </div>
      )}
      {editing !== undefined && (
        <FormEditorDialog form={editing} onClose={() => setEditing(undefined)} />
      )}
    </SectionPageView>
  );
}
