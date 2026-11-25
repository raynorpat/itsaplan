import type { FormConfirmInfo } from '../services/forms.service';

// The answers a confirmation carries, so the person sees what they are confirming.
export default function FormsConfirmAnswers({ answers }: { answers: FormConfirmInfo['answers'] }) {
  if (answers.length === 0) return null;
  return (
    <dl className="flex flex-col gap-3 rounded-md border p-3 text-sm">
      {answers.map((a, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">{a.label}</dt>
          <dd className="break-words whitespace-pre-wrap">{a.answer}</dd>
        </div>
      ))}
    </dl>
  );
}
