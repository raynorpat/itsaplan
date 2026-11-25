'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDeleteForm, useSaveForm } from '../services/formsAdmin.service';
import { formEditorErrors, type FormEditorState } from '../utils/formEditor';
import FormIssueFields from './FormIssueFields';
import FormQuestions from './FormQuestions';
import FormPublishSettings from './FormPublishSettings';

// The form editor: what the issue gets, the questions, and where the form is shown.
// Problems show once Save was pressed; the API's own refusals (a taken address)
// reach the global error toast.
export default function FormEditor({
  templateId,
  initial,
  existing,
  onClose,
}: {
  templateId: string | null;
  initial: FormEditorState;
  existing: unknown;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormEditorState>(initial);
  // The template id once a save created it, so a retry after a failed settings save
  // updates that template.
  const [savedId, setSavedId] = useState(templateId);
  const [tried, setTried] = useState(false);
  const save = useSaveForm();
  const remove = useDeleteForm();
  const errors = tried ? formEditorErrors(form) : {};
  const set = (patch: Partial<FormEditorState>) => setForm((f) => ({ ...f, ...patch }));

  function submit() {
    setTried(true);
    if (Object.keys(formEditorErrors(form)).length > 0) return;
    save.mutate(
      { templateId: savedId, form, existing, onCreated: setSavedId },
      { onSuccess: onClose },
    );
  }

  function deleteForm() {
    if (
      !templateId ||
      !window.confirm(`Delete the form "${initial.name}"? Its link stops working.`)
    )
      return;
    remove.mutate(templateId, { onSuccess: onClose });
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormIssueFields form={form} errors={errors} set={set} teamLocked={savedId != null} />
      <FormQuestions
        fields={form.fields}
        errors={errors}
        onChange={(fields) => set({ fields })}
        teamId={form.teamId}
      />
      <FormPublishSettings form={form} errors={errors} set={set} />
      <div className="flex items-center justify-between gap-2">
        <div>
          {templateId && (
            <Button type="button" variant="ghost" className="text-destructive" onClick={deleteForm}>
              Delete form
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {templateId ? 'Save' : 'Create form'}
          </Button>
        </div>
      </div>
    </form>
  );
}
