import { Input } from '@/components/ui/input';

// Email and name for someone not signed in to the portal, with their problems under them.
export default function FormsContactFields({
  email,
  name,
  errors,
  onEmail,
  onName,
}: {
  email: string;
  name: string;
  errors: { email?: string; name?: string };
  onEmail: (value: string) => void;
  onName: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Your email
        <Input
          type="email"
          autoComplete="email"
          required
          value={email}
          aria-invalid={!!errors.email}
          onChange={(e) => onEmail(e.target.value)}
        />
        {errors.email && (
          <span className="text-xs font-normal text-destructive">{errors.email}</span>
        )}
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Your name
        <Input
          autoComplete="name"
          required
          value={name}
          aria-invalid={!!errors.name}
          onChange={(e) => onName(e.target.value)}
        />
        {errors.name && <span className="text-xs font-normal text-destructive">{errors.name}</span>}
      </label>
    </div>
  );
}
