'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRequestLink } from '../../services/portal.service';

// Asks for a sign-in link. The answer is the same whether or not the address has
// access, so the page reveals nothing about who may read the board.
export default function PortalSignInForm({ slug }: { slug: string }) {
  const [email, setEmail] = useState('');
  const request = useRequestLink();
  if (request.isSuccess)
    return (
      <p className="text-sm" role="status">
        If this address has access, a link is on its way. Open it in this browser to sign in.
      </p>
    );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim()) request.mutate({ email: email.trim(), board: slug });
      }}
    >
      <Input
        type="email"
        aria-label="Email address"
        placeholder="you@example.com"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button type="submit" disabled={request.isPending}>
        Email me a sign-in link
      </Button>
    </form>
  );
}
