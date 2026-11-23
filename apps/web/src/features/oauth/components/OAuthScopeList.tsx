import { Check } from 'lucide-react';
import { describeScopes } from '@/utils/oauthScopes';

// What the application asks to do, in plain words.
export default function OAuthScopeList({ scopes }: { scopes: string[] }) {
  const described = describeScopes(scopes);
  return (
    <ul className="flex flex-col gap-2">
      {described.map(({ scope, label }) => (
        <li key={scope} className="flex items-start gap-2 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}
