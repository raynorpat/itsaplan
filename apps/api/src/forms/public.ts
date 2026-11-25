import { randomBytes } from 'node:crypto';
import { db, formSettings, formSubmission, team, template } from '@repo/db';
import { and, arrayContains, asc, eq, gt, isNull, lt } from 'drizzle-orm';
import { requesterByEmail } from '../feedback/requesters';
import { canReadBoard } from '../portal/access';
import { boardsShowingIssue, type BoardRow } from '../portal/boards';
import { allow, LIMITS } from '../portal/rate-limit';
import {
  cleanEmail,
  cleanName,
  hashToken,
  mailPortalLink,
  requesterFor,
  startSession,
  webOrigin,
  type Visitor,
} from '../portal/session';
import { HttpError } from '../shared/lib';
import type { FormField, IssueTemplateData } from '../templates/data';
import {
  boardMayShowForm,
  getFormBySlug,
  getFormByTemplateId,
  validateAnswers,
  type FormRow,
} from './settings';
import { submitForm } from './submit';

// The public side of forms, under the portal's routes. On its link (`/forms/<slug>`),
// someone not signed in to the portal submits with their email and name; nothing is
// created until they confirm the address through the mailed link, which then creates
// the issue and signs them in to the portal. A signed-in visitor's submission is
// created at once. On a portal board, only signed-in visitors submit.

const SUBMISSION_TTL_MS = 24 * 60 * 60_000;

// A form field as the public sees it: options without the labels and priority they set.
export type PublicField = Omit<FormField, 'options'> & {
  options?: { id: string; label: string }[];
};

export interface PublicForm {
  slug: string;
  name: string;
  intro: string;
  fields: PublicField[];
}

export interface Created {
  identifier: string;
  // The boards showing the new issue that the person may read.
  boards: { slug: string; name: string }[];
}

const publicField = ({ options, ...field }: FormField): PublicField =>
  options ? { ...field, options: options.map(({ id, label }) => ({ id, label })) } : field;

const publicForm = (form: FormRow): PublicForm => ({
  slug: form.settings.slug,
  name: form.template.name,
  intro: form.settings.intro,
  fields: (form.data.formFields ?? []).map(publicField),
});

const notFound = (): never => {
  throw new HttpError(404, 'Form not found');
};

// The form whose link is on, or 404.
export async function linkForm(slug: string): Promise<PublicForm> {
  const form = await getFormBySlug(slug);
  if (!form?.settings.linkEnabled) return notFound();
  return publicForm(form);
}

async function created(
  identifier: string,
  issueId: string,
  visitor: Visitor | null,
): Promise<Created> {
  const boards = (await boardsShowingIssue(issueId)).filter((b) => canReadBoard(b, visitor));
  return { identifier, boards: boards.map((b) => ({ slug: b.slug, name: b.name })) };
}

function submissionLimit(visitor: Visitor): void {
  const { suggestions } = LIMITS;
  if (!allow(`suggestion:${visitor.requesterId}`, suggestions.limit, suggestions.windowMs))
    throw new HttpError(429, 'Too many requests. Try again later.');
}

// A submission on the form's link. A signed-in visitor's creates the issue at once.
// Otherwise the answers, email and name are checked and the answer is always
// `pending`: the confirmation link is stored and mailed only when the address is not
// blocked and within its link limit (it shares the portal's sign-in link limit). `ip`
// is the client address when known (over its limit: 429, which tells nothing about
// the address).
export async function submitOnLink(
  slug: string,
  input: Record<string, unknown>,
  visitor: Visitor | null,
  ip: string | null,
): Promise<({ status: 'created' } & Created) | { status: 'pending' }> {
  const form = await getFormBySlug(slug);
  if (!form?.settings.linkEnabled) return notFound();
  const answers = validateAnswers(form, input.answers);
  if (visitor) {
    submissionLimit(visitor);
    const issue = await submitForm(form, answers, visitor.requesterId, {
      boardId: null,
      projectId: null,
    });
    return { status: 'created', ...(await created(issue.identifier, issue.issueId, visitor)) };
  }

  const email = cleanEmail(input.email);
  const name = cleanName(input.name, 'name');
  const { formSubmissions, linksPerAddress } = LIMITS;
  if (ip && !allow(`form-ip:${ip}`, formSubmissions.limit, formSubmissions.windowMs))
    throw new HttpError(429, 'Too many requests. Try again later.');
  if (!allow(`link:${email}`, linksPerAddress.limit, linksPerAddress.windowMs))
    return { status: 'pending' };
  const known = await requesterByEmail(email);
  if (known?.portalBlockedAt) return { status: 'pending' };

  const token = randomBytes(32).toString('base64url');
  await db.delete(formSubmission).where(lt(formSubmission.expiresAt, new Date()));
  await db.insert(formSubmission).values({
    tokenHash: hashToken(token),
    templateId: form.template.id,
    email,
    name,
    answers,
    expiresAt: new Date(Date.now() + SUBMISSION_TTL_MS),
  });
  mailPortalLink({
    to: email,
    subject: `Confirm your request: ${form.template.name}`,
    text: 'Confirm your request with the link below. It works once and expires in 24 hours.',
    url: `${webOrigin()}/forms/${form.settings.slug}/confirm?token=${token}`,
    logPrefix: '[portal] form confirmation link for',
  });
  return { status: 'pending' };
}

const invalidLink = (): never => {
  throw new HttpError(400, 'This link is not valid or has expired');
};

async function usableSubmission(token: unknown) {
  if (typeof token !== 'string' || !token) return invalidLink();
  const [row] = await db
    .select()
    .from(formSubmission)
    .where(
      and(
        eq(formSubmission.tokenHash, hashToken(token)),
        isNull(formSubmission.usedAt),
        gt(formSubmission.expiresAt, new Date()),
      ),
    );
  return row ?? invalidLink();
}

// The form a pending submission belongs to, while it still takes submissions.
async function submissionForm(templateId: string): Promise<FormRow> {
  const form = await getFormByTemplateId(templateId);
  if (!form?.settings.linkEnabled) throw new HttpError(400, 'This form no longer takes requests');
  return form;
}

// What the confirm page shows before its button is pressed.
export async function confirmInfo(token: unknown): Promise<{ formName: string }> {
  const row = await usableSubmission(token);
  return { formName: (await submissionForm(row.templateId)).template.name };
}

// Uses the confirmation link (once): checks the form still takes requests and its
// answers still fit it, and that the address's requester is not blocked, before
// anything is created; then creates the requester when new, the issue and its
// feedback, and a portal session for the address.
export async function confirmSubmission(
  token: unknown,
): Promise<Created & { sessionToken: string }> {
  const pending = await usableSubmission(token);
  const form = await submissionForm(pending.templateId);
  let answers;
  try {
    answers = validateAnswers(form, pending.answers);
  } catch {
    throw new HttpError(400, 'This form has changed. Fill it in again.');
  }
  let requester = await requesterByEmail(pending.email);
  if (requester?.portalBlockedAt) return invalidLink();

  const [claimed] = await db
    .update(formSubmission)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(formSubmission.id, pending.id),
        isNull(formSubmission.usedAt),
        gt(formSubmission.expiresAt, new Date()),
      ),
    )
    .returning({ id: formSubmission.id });
  if (!claimed) return invalidLink();

  requester ??= await requesterFor(pending.email, pending.name);
  if (requester.portalBlockedAt) return invalidLink();
  const issue = await submitForm(form, answers, requester.id, { boardId: null, projectId: null });
  const sessionToken = await startSession(requester.id, pending.email);
  const visitor: Visitor = {
    requesterId: requester.id,
    email: pending.email,
    displayName: requester.displayName,
    avatarUrl: requester.avatarUrl,
  };
  return { sessionToken, ...(await created(issue.identifier, issue.issueId, visitor)) };
}

// The forms placed on `board` that still fit it (the form's team public, the board a
// team board of that team or a project board whose project includes it). The caller
// checks the visitor may read the board.
export async function boardForms(board: BoardRow): Promise<PublicForm[]> {
  const rows = await db
    .select({ template, settings: formSettings })
    .from(formSettings)
    .innerJoin(template, eq(template.id, formSettings.templateId))
    .innerJoin(team, eq(team.id, template.teamId))
    .where(
      and(
        arrayContains(formSettings.boardIds, [board.id]),
        isNull(template.archivedAt),
        eq(team.visibility, 'public'),
      ),
    )
    .orderBy(asc(template.name));
  const forms: PublicForm[] = [];
  for (const row of rows) {
    if (!(await boardMayShowForm(board, row.template.teamId!))) continue;
    forms.push(
      publicForm({
        template: row.template,
        data: row.template.templateData as IssueTemplateData,
        settings: row.settings,
      }),
    );
  }
  return forms;
}

// A signed-in visitor's submission of a form placed on `board`; 404 when the form is
// not on the board (or no longer fits it). The issue records the board, and a project
// board's project.
export async function submitOnBoard(
  board: BoardRow,
  slug: string,
  visitor: Visitor,
  input: Record<string, unknown>,
): Promise<Created> {
  const form = await getFormBySlug(slug);
  if (
    !form ||
    !form.settings.boardIds.includes(board.id) ||
    !(await boardMayShowForm(board, form.template.teamId!))
  )
    return notFound();
  const answers = validateAnswers(form, input.answers);
  submissionLimit(visitor);
  const issue = await submitForm(form, answers, visitor.requesterId, {
    boardId: board.id,
    projectId: board.projectId,
  });
  return created(issue.identifier, issue.issueId, visitor);
}
