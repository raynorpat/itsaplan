'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import FormFieldInput from '@/components/common/inputs/FormFieldInput';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { answerErrors, emptyAnswers, titleAnswer } from '@/utils/formAnswers';
import {
  usePortalSimilar,
  useSubmitBoardForm,
  type PortalBoardForm,
} from '../../services/portal.service';
import PortalIssueRow from '../PortalIssueRow';

// One of the board's forms, for a signed-in visitor. While the title question is
// answered, matching issues on the board are offered, so a vote can go to an existing
// issue instead of a duplicate.
export default function PortalFormDialog({
  slug,
  form,
  onClose,
}: {
  slug: string;
  form: PortalBoardForm;
  onClose: () => void;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState(() => emptyAnswers(form.fields));
  const [showErrors, setShowErrors] = useState(false);
  const submit = useSubmitBoardForm(slug);
  const errors = answerErrors(form.fields, answers);
  const similar = usePortalSimilar(slug, useDebouncedValue(titleAnswer(form.fields, answers), 300));
  const matches = similar.data ?? [];

  return (
    <Modal title={form.name} description={form.intro || undefined} onClose={onClose} wide>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setShowErrors(true);
          if (Object.keys(errors).length > 0) return;
          submit.mutate(
            { form: form.slug, answers },
            { onSuccess: ({ identifier }) => router.push(`/portal/${slug}/${identifier}`) },
          );
        }}
      >
        {form.fields.map((field) => (
          <div key={field.id} className="flex flex-col gap-2">
            <FormFieldInput
              field={field}
              value={answers[field.id]}
              error={showErrors ? errors[field.id] : undefined}
              onChange={(value) => setAnswers((a) => ({ ...a, [field.id]: value }))}
            />
            {field.role === 'title' && matches.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">
                  Is it one of these? Vote for it instead.
                </p>
                <ul className="flex flex-col">
                  {matches.map((issue) => (
                    <PortalIssueRow key={issue.identifier} slug={slug} issue={issue} signedIn />
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
        {submit.error && (
          <p className="text-sm text-destructive" role="alert">
            {submit.error.message}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={submit.isPending}>
            Send request
          </Button>
        </div>
      </form>
    </Modal>
  );
}
