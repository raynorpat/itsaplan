'use client';

import Modal from '@/components/common/overlay/Modal';
import { useFormTemplate, type FormDto } from '../services/formsAdmin.service';
import { editorFromForm, emptyFormEditor } from '../utils/formEditor';
import FormEditor from './FormEditor';

// Creates (`form` null) or edits a form; an edited form's template is read first so
// its questions and the template data the editor does not show are kept.
export default function FormEditorDialog({
  form,
  onClose,
}: {
  form: FormDto | null;
  onClose: () => void;
}) {
  const template = useFormTemplate(form?.templateId ?? null);
  const loading = form != null && template.isPending;

  return (
    <Modal title={form ? 'Edit form' : 'New form'} onClose={onClose} wide>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {form && template.isError && (
        <p className="text-sm text-destructive">This form could not be loaded.</p>
      )}
      {!form && (
        <FormEditor templateId={null} initial={emptyFormEditor()} existing={{}} onClose={onClose} />
      )}
      {form && template.data && (
        <FormEditor
          templateId={form.templateId}
          initial={editorFromForm(
            {
              name: template.data.name,
              teamId: form.teamId,
              templateData: template.data.templateData,
            },
            form,
          )}
          existing={template.data.templateData}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
