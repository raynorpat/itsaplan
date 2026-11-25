import Link from 'next/link';
import type { FormCreated } from '../services/forms.service';

// After a request is created: thanks, and where the person can follow it.
export default function FormsSubmitted({ created }: { created: FormCreated }) {
  return (
    <div className="flex flex-col gap-2" role="status">
      <h2 className="text-base font-semibold">Thanks, your request is in</h2>
      {created.boards.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {created.boards.map((b) => (
            <li key={b.slug}>
              <Link className="underline" href={`/portal/${b.slug}/${created.identifier}`}>
                Follow it on {b.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">The team will look at it soon.</p>
      )}
    </div>
  );
}
