import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// The Jira site a Jira export came from, optional: when given, each imported issue
// links back to its Jira page.
export default function CsvJiraHostField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="import-jira-host">Jira site (optional)</Label>
      <Input
        id="import-jira-host"
        className="w-full sm:w-72"
        placeholder="acme.atlassian.net"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Each issue links back to its Jira page when this is set.
      </p>
    </div>
  );
}
