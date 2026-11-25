import { customer, db, externalUser } from '@repo/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { BoardRow } from './boards';
import type { Visitor } from './session';

// Who may read a board. Public: anyone. Restricted: an address whose domain is in
// `allowed_domains` or that is in `allowed_emails`. Customer: a person whose current
// customer is the board's (by domain or a member's pick); a board whose customer was
// deleted is read by no one. Customer boards are not served at all while Customers is
// off (boards.ts).

export interface PersonAccess {
  email: string | null;
  customerId: string | null;
}

export function personMayRead(board: BoardRow, person: PersonAccess): boolean {
  if (board.access === 'public') return true;
  if (board.access === 'customer')
    return board.customerId != null && person.customerId === board.customerId;
  if (!person.email) return false;
  const address = person.email.toLowerCase();
  const domain = address.slice(address.lastIndexOf('@') + 1);
  return board.allowedDomains.includes(domain) || board.allowedEmails.includes(address);
}

// Checked on every portal request, so a changed board, a blocked visitor or a person
// moved to another customer takes effect at once (visitorFromRequest returns null for a
// blocked requester and reads the person's current customer). The visitor's email is
// the address that confirmed their sign-in link.
export const canReadBoard = (board: BoardRow, visitor: Visitor | null): boolean =>
  personMayRead(board, {
    email: visitor?.email ?? null,
    customerId: visitor?.customerId ?? null,
  });

// Whether a sign-in link may be sent to `email` for the board. A customer board: the
// address's domain is one of the customer's domains, or the address belongs to a person
// linked to the customer (a member's pick).
export async function addressMayRead(board: BoardRow, email: string): Promise<boolean> {
  if (board.access !== 'customer') return personMayRead(board, { email, customerId: null });
  if (!board.customerId) return false;
  const address = email.toLowerCase();
  const domain = address.slice(address.lastIndexOf('@') + 1);
  const [row] = await db
    .select({ domains: customer.domains })
    .from(customer)
    .where(eq(customer.id, board.customerId));
  if (!row) return false;
  if (row.domains.includes(domain)) return true;
  const [linked] = await db
    .select({ id: externalUser.id })
    .from(externalUser)
    .where(
      and(
        eq(externalUser.email, address),
        eq(externalUser.customerId, board.customerId),
        isNull(externalUser.mergedIntoId),
      ),
    );
  return !!linked;
}
