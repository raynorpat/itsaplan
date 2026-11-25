import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCustomersEnabled } from '@/hooks/useCustomersEnabled';
import { useCustomers } from '@/services/customers.service';
import type { BoardForm } from '../utils/board';
import PortalBoardField from './PortalBoardField';

// Public, restricted to visitors whose address is on the board's lists, or (while
// Customers is on) open only to one customer's people.
export default function PortalBoardAccessFields({
  form,
  errors,
  set,
}: {
  form: BoardForm;
  errors: Record<string, string>;
  set: (patch: Partial<BoardForm>) => void;
}) {
  const customersOn = useCustomersEnabled();
  const customers = useCustomers(undefined, customersOn).data ?? [];
  const hint = {
    public:
      'Anyone with the link can read; voting, commenting and suggesting need an emailed sign-in link.',
    restricted: 'Only visitors signed in with an allowed address can read the board.',
    customer:
      "Only the customer's people can read the board, and they see only their own votes and threads.",
  }[form.access];
  return (
    <div className="grid gap-4">
      <PortalBoardField id="board-access" label="Access" hint={hint} error={errors.access}>
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
            {(customersOn || form.access === 'customer') && (
              <SelectItem value="customer">Customer</SelectItem>
            )}
          </SelectContent>
        </Select>
      </PortalBoardField>
      {form.access === 'customer' && (
        <PortalBoardField id="board-customer" label="Customer">
          <Select value={form.customerId} onValueChange={(customerId) => set({ customerId })}>
            <SelectTrigger id="board-customer" className="w-full sm:w-72">
              <SelectValue placeholder="Pick a customer" />
            </SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PortalBoardField>
      )}
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
