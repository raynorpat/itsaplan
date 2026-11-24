import type { BoardRow } from './boards';
import type { Visitor } from './session';

// Whether an address may read a board: anyone on a public board; on a restricted board
// an address whose domain is in `allowed_domains` or that is in `allowed_emails`.
export function emailMayRead(board: BoardRow, email: string | null): boolean {
  if (board.access === 'public') return true;
  if (!email) return false;
  const address = email.toLowerCase();
  const domain = address.slice(address.lastIndexOf('@') + 1);
  return board.allowedDomains.includes(domain) || board.allowedEmails.includes(address);
}

// Checked on every portal request, so a changed board or a blocked visitor takes effect
// at once (visitorFromRequest returns null for a blocked requester). The visitor's
// email is the address that confirmed their sign-in link.
export const canReadBoard = (board: BoardRow, visitor: Visitor | null): boolean =>
  emailMayRead(board, visitor?.email ?? null);
