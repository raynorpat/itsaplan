'use client';

import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { UPDATES_NOTICE } from '@/utils/updatesNotice';
import { useConfirmForm, useFormConfirmInfo } from './services/forms.service';
import FormsMessage from './components/FormsMessage';
import FormsSubmitted from './components/FormsSubmitted';
import FormsConfirmAnswers from './components/FormsConfirmAnswers';

// /forms/<slug>/confirm?token=: the page the confirmation email opens. The request is
// sent only by pressing the button, so a mail scanner that opens the link sends nothing.
export default function FormsConfirmPage() {
  const token = useSearchParams().get('token') ?? '';
  const info = useFormConfirmInfo(token);
  const confirm = useConfirmForm();

  if (confirm.data)
    return (
      <section className="py-16">
        <FormsSubmitted created={confirm.data} />
      </section>
    );
  if (!token || info.error)
    return (
      <FormsMessage
        title="This link is not valid"
        text={
          info.error?.message === 'This form has changed. Fill it in again.'
            ? info.error.message
            : 'It may have expired or been used already. Fill in the form again.'
        }
      />
    );
  if (info.isPending) return <Skeleton className="mt-16 h-24 w-full" />;
  return (
    <section className="mx-auto flex max-w-md flex-col gap-4 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold">Confirm your request</h1>
        <p className="text-sm text-muted-foreground">{info.data.formName}</p>
      </div>
      <FormsConfirmAnswers answers={info.data.answers} />
      {confirm.error && (
        <p className="text-sm text-destructive" role="alert">
          {confirm.error.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{UPDATES_NOTICE}</p>
      <Button disabled={confirm.isPending} onClick={() => confirm.mutate(token)}>
        Confirm request
      </Button>
    </section>
  );
}
