import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BoardForm } from '../utils/board';
import PortalBoardField from './PortalBoardField';

// Public, or restricted to visitors whose address is on the board's lists.
export default function PortalBoardAccessFields({
  form,
  errors,
  set,
}: {
  form: BoardForm;
  errors: Record<string, string>;
  set: (patch: Partial<BoardForm>) => void;
}) {
  return (
    <div className="grid gap-4">
      <PortalBoardField
        id="board-access"
        label="Access"
        hint={
          form.access === 'public'
            ? 'Anyone with the link can read; voting, commenting and suggesting need an emailed sign-in link.'
            : 'Only visitors signed in with an allowed address can read the board.'
        }
        error={errors.access}
      >
        <Select
          value={form.access}
          onValueChange={(v) => set({ access: v as BoardForm['access'] })}
        >
          <SelectTrigger id="board-access" className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="restricted">Restricted</SelectItem>
          </SelectContent>
        </Select>
      </PortalBoardField>
      {form.access === 'restricted' && (
        <>
          <PortalBoardField
            id="board-domains"
            label="Allowed email domains"
            hint="Comma-separated, for example acme.com, acme.io"
            error={errors.domains}
          >
            <Textarea
              id="board-domains"
              rows={2}
              value={form.domains}
              onChange={(e) => set({ domains: e.target.value })}
            />
          </PortalBoardField>
          <PortalBoardField
            id="board-emails"
            label="Allowed email addresses"
            hint="One per line, for people outside the allowed domains."
            error={errors.emails}
          >
            <Textarea
              id="board-emails"
              rows={3}
              value={form.emails}
              onChange={(e) => set({ emails: e.target.value })}
            />
          </PortalBoardField>
        </>
      )}
    </div>
  );
}
