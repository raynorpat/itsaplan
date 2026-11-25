'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PortalBoardForm } from '../../services/portal.service';
import PortalFormDialog from './PortalFormDialog';
import PortalSuggestDialog from './PortalSuggestDialog';

// How a visitor sends a new request: the board's forms when it has any (one button,
// or a menu of form names), else the Suggest box when suggestions are on. Signing in
// comes first.
export default function PortalRequestActions({
  slug,
  forms,
  suggestionsEnabled,
  signedIn,
}: {
  slug: string;
  forms: PortalBoardForm[];
  suggestionsEnabled: boolean;
  signedIn: boolean;
}) {
  const [suggesting, setSuggesting] = useState(false);
  const [form, setForm] = useState<PortalBoardForm | null>(null);
  const hasForms = forms.length > 0;
  if (!hasForms && !suggestionsEnabled) return null;

  if (!signedIn)
    return (
      <Button asChild variant="outline" className="ml-auto">
        <Link href={`/portal/${slug}/sign-in`}>
          {hasForms ? 'Sign in to submit a request' : 'Sign in to suggest'}
        </Link>
      </Button>
    );

  let trigger;
  if (!hasForms)
    trigger = (
      <Button className="ml-auto" onClick={() => setSuggesting(true)}>
        Suggest a request
      </Button>
    );
  else if (forms.length === 1)
    trigger = (
      <Button className="ml-auto" onClick={() => setForm(forms[0]!)}>
        Submit a request
      </Button>
    );
  else
    trigger = (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="ml-auto">Submit a request</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {forms.map((f) => (
            <DropdownMenuItem key={f.slug} onSelect={() => setForm(f)}>
              {f.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  return (
    <>
      {trigger}
      {suggesting && <PortalSuggestDialog slug={slug} onClose={() => setSuggesting(false)} />}
      {form && <PortalFormDialog slug={slug} form={form} onClose={() => setForm(null)} />}
    </>
  );
}
