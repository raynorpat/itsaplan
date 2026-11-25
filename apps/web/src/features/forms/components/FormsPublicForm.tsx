'use client';

import { useState } from 'react';
import FormFieldInput from '@/components/common/inputs/FormFieldInput';
import { Button } from '@/components/ui/button';
import { answerErrors, emptyAnswers } from '@/utils/formAnswers';
import { useSubmitForm, type PublicForm } from '../services/forms.service';
import { contactErrors } from '../utils/contact';
import FormsContactFields from './FormsContactFields';
import FormsSubmitted from './FormsSubmitted';

// The questions of a form's link, plus email and name for someone not signed in to the
// portal. Their request waits for the emailed confirmation; a signed-in visitor's is
// created at once.
export default function FormsPublicForm({ form }: { form: PublicForm }) {
  const [answers, setAnswers] = useState(() => emptyAnswers(form.fields));
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const submit = useSubmitForm(form.slug);
  const errors = answerErrors(form.fields, answers);
  const signedIn = !!form.visitor;
  const contact = signedIn ? {} : contactErrors(email, name);

  if (submit.data?.status === 'pending')
    return (
      <div className="flex flex-col gap-2" role="status">
        <h2 className="text-base font-semibold">Check your email to confirm your request</h2>
        <p className="text-sm text-muted-foreground">
          We sent a link to {email.trim()}. Your request is sent once you confirm it.
        </p>
      </div>
    );
  if (submit.data?.status === 'created') return <FormsSubmitted created={submit.data} />;

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setShowErrors(true);
        if (Object.keys(errors).length > 0 || Object.keys(contact).length > 0) return;
        submit.mutate(signedIn ? { answers } : { answers, email: email.trim(), name: name.trim() });
      }}
    >
      {form.fields.map((field) => (
        <FormFieldInput
          key={field.id}
          field={field}
          value={answers[field.id]}
          error={showErrors ? errors[field.id] : undefined}
          onChange={(value) => setAnswers((a) => ({ ...a, [field.id]: value }))}
        />
      ))}
      {signedIn ? (
        <p className="text-sm text-muted-foreground">Sending as {form.visitor!.displayName}.</p>
      ) : (
        <FormsContactFields
          email={email}
          name={name}
          errors={showErrors ? contact : {}}
          onEmail={setEmail}
          onName={setName}
        />
      )}
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
  );
}
