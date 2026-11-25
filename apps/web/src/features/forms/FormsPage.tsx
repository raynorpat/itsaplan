'use client';

import { useParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/graphql';
import { usePublicForm } from './services/forms.service';
import FormsMessage from './components/FormsMessage';
import FormsPublicForm from './components/FormsPublicForm';

// /forms/<slug>: a form shared as a link, for people outside the workspace.
export default function FormsPage() {
  const { slug } = useParams<{ slug: string }>();
  const form = usePublicForm(slug);

  if (form.isPending) return <Skeleton className="mt-10 h-64 w-full" />;
  if (form.error)
    return form.error instanceof ApiError && form.error.status === 404 ? (
      <FormsMessage title="Form not found" text="Check the link you were given." />
    ) : (
      <FormsMessage title="Something went wrong" text="Try again in a moment." />
    );
  return (
    <section className="flex flex-col gap-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{form.data.name}</h1>
        {form.data.intro && (
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{form.data.intro}</p>
        )}
      </div>
      <FormsPublicForm form={form.data} />
    </section>
  );
}
