import { db, formSettings, portalBoard, projectTeam, team, template } from '@repo/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { BoardRow } from '../portal/boards';
import { HttpError } from '../shared/lib';
import type { FormField, IssueTemplateData } from '../templates/data';
import type { TemplateRow } from '../templates/store';

// A form: a team issue template of a public team with a form_settings row. Its answers
// are checked against the template's form fields and written into the issue it creates.

export type FormSettingsRow = typeof formSettings.$inferSelect;

export interface FormRow {
  template: TemplateRow;
  data: IssueTemplateData;
  settings: FormSettingsRow;
}

// Answers by form field id: text for text fields and selects, a list of option ids for
// a multi-select, a boolean for a checkbox.
export type Answers = Record<string, string | string[] | boolean>;

export const MAX_ANSWER = 10_000;

// The form at `/forms/<slug>`, or null when there is none, its template is archived, or
// its team is private.
export async function getFormBySlug(slug: string): Promise<FormRow | null> {
  return findForm(eq(formSettings.slug, slug));
}

export async function getFormByTemplateId(templateId: string): Promise<FormRow | null> {
  return findForm(eq(formSettings.templateId, templateId));
}

async function findForm(where: ReturnType<typeof eq>): Promise<FormRow | null> {
  const [row] = await db
    .select({ template, settings: formSettings })
    .from(formSettings)
    .innerJoin(template, eq(template.id, formSettings.templateId))
    .innerJoin(team, eq(team.id, template.teamId))
    .where(and(where, isNull(template.archivedAt), eq(team.visibility, 'public')));
  if (!row) return null;
  return {
    template: row.template,
    data: row.template.templateData as IssueTemplateData,
    settings: row.settings,
  };
}

// Whether a form of `teamId` may be shown on `board`: a team board of that team, or a
// project board whose project includes it.
export async function boardMayShowForm(board: BoardRow, teamId: string): Promise<boolean> {
  if (board.teamId) return board.teamId === teamId;
  if (!board.projectId) return false;
  const [row] = await db
    .select({ teamId: projectTeam.teamId })
    .from(projectTeam)
    .where(and(eq(projectTeam.projectId, board.projectId), eq(projectTeam.teamId, teamId)));
  return Boolean(row);
}

export async function boardsByIds(ids: string[]): Promise<BoardRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(portalBoard).where(inArray(portalBoard.id, ids));
}

const fieldsOf = (form: FormRow): FormField[] => form.data.formFields ?? [];

const bad = (message: string): never => {
  throw new HttpError(400, message);
};

function checkText(field: FormField, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return bad(`${field.label} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > MAX_ANSWER)
    bad(`${field.label} is at most ${MAX_ANSWER.toLocaleString('en')} characters`);
  return trimmed === '' ? undefined : trimmed;
}

const optionIds = (field: FormField) => new Set((field.options ?? []).map((o) => o.id));

// The answers kept from `raw`: required questions answered, every answer of the
// form's fields and type, options only from the field, text at most 10,000 characters.
// Empty answers are left out.
export function validateAnswers(form: FormRow, raw: unknown): Answers {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return bad('answers must be an object');
  const input = raw as Record<string, unknown>;
  const fields = fieldsOf(form);
  const known = new Set(fields.map((f) => f.id));
  const unknown = Object.keys(input).find((k) => !known.has(k));
  if (unknown) bad(`Unknown question ${unknown}`);
  const answers: Answers = {};
  for (const field of fields) {
    const value = input[field.id];
    let answer: string | string[] | boolean | undefined;
    switch (field.type) {
      case 'shortText':
      case 'longText':
        answer = checkText(field, value);
        break;
      case 'select':
        if (value === undefined || value === null || value === '') break;
        if (typeof value !== 'string' || !optionIds(field).has(value))
          bad(`${field.label} has no such option`);
        answer = value as string;
        break;
      case 'multiSelect': {
        if (value === undefined || value === null) break;
        if (!Array.isArray(value)) return bad(`${field.label} must be a list of options`);
        const ids = optionIds(field);
        if (value.some((v) => typeof v !== 'string' || !ids.has(v)))
          bad(`${field.label} has no such option`);
        const chosen = [...new Set(value as string[])];
        if (chosen.length > 0) answer = chosen;
        break;
      }
      case 'checkbox':
        if (value === undefined || value === null) break;
        if (typeof value !== 'boolean') bad(`${field.label} must be true or false`);
        answer = value as boolean;
        break;
    }
    const missing = answer === undefined || (field.type === 'checkbox' && answer === false);
    if (field.required && missing) bad(`${field.label} is required`);
    if (answer !== undefined) answers[field.id] = answer;
  }
  return answers;
}

export function answerText(field: FormField, answer: string | string[] | boolean): string {
  const optionLabel = (id: string) => field.options?.find((o) => o.id === id)?.label ?? id;
  if (typeof answer === 'boolean') return answer ? 'Yes' : 'No';
  if (Array.isArray(answer)) return answer.map(optionLabel).join(', ');
  return field.type === 'select' ? optionLabel(answer) : answer;
}

// The issue description: the template's description, a blank line, then each answered
// question in form order as "**Question**", a blank line and the answer. Answers are
// kept as written.
export function formIssueDescription(form: FormRow, answers: Answers): string {
  const blocks: string[] = [];
  if (form.data.description) blocks.push(form.data.description);
  for (const field of fieldsOf(form)) {
    const answer = answers[field.id];
    if (answer === undefined) continue;
    blocks.push(`**${field.label}**\n\n${answerText(field, answer)}`);
  }
  return blocks.join('\n\n');
}

// The answered questions in form order, as plain text: option labels, "Yes" / "No".
export function answerList(form: FormRow, answers: Answers): { label: string; answer: string }[] {
  return fieldsOf(form).flatMap((field) => {
    const answer = answers[field.id];
    return answer === undefined ? [] : [{ label: field.label, answer: answerText(field, answer) }];
  });
}

// Stored answers checked against the form as it is now: answers to questions removed
// since are dropped; a question that became required, or an option that is gone, makes
// them unusable (400 "This form has changed").
export function storedAnswers(form: FormRow, raw: unknown): Answers {
  const known = new Set(fieldsOf(form).map((f) => f.id));
  const kept =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw).filter(([id]) => known.has(id)))
      : {};
  try {
    return validateAnswers(form, kept);
  } catch {
    throw new HttpError(400, 'This form has changed. Fill it in again.');
  }
}

// The options chosen in the answers, in form order.
export function chosenOptions(form: FormRow, answers: Answers) {
  return fieldsOf(form).flatMap((field) => {
    const answer = answers[field.id];
    if (field.type === 'select' && typeof answer === 'string')
      return (field.options ?? []).filter((o) => o.id === answer);
    if (field.type === 'multiSelect' && Array.isArray(answer))
      return (field.options ?? []).filter((o) => answer.includes(o.id));
    return [];
  });
}

export const roleAnswer = (form: FormRow, answers: Answers, role: 'title' | 'quote') => {
  const field = fieldsOf(form).find((f) => f.role === role);
  const answer = field ? answers[field.id] : undefined;
  return typeof answer === 'string' ? answer : undefined;
};
