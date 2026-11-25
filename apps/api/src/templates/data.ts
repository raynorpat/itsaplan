import { db, label, workflowState } from '@repo/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { assertLabelsApplicable } from '../labels/store';
import { HttpError, UUID_RE } from '../shared/lib';

// The configuration of an issue template (Linear's Template.templateData for type
// issue). Linear does not publish its shape; this instance stores the fields an issue
// gets (title, description in Markdown, state, labels, priority) and the form fields a
// form asks (forms/). Unknown keys are refused.

export type FormFieldType = 'shortText' | 'longText' | 'select' | 'multiSelect' | 'checkbox';

export interface FormFieldOption {
  id: string;
  label: string;
  // Choosing the option adds this label to the issue and / or sets this priority.
  labelId?: string;
  priority?: number;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  // The title field's answer is the issue title; the quote field's is the feedback quote.
  role?: 'title' | 'quote';
  options?: FormFieldOption[];
}

export interface IssueTemplateData {
  title?: string;
  description?: string;
  stateId?: string;
  labelIds?: string[];
  priority?: number;
  formFields?: FormField[];
}

const FIELD_TYPES = new Set<FormFieldType>([
  'shortText',
  'longText',
  'select',
  'multiSelect',
  'checkbox',
]);
const DATA_KEYS = new Set([
  'title',
  'description',
  'stateId',
  'labelIds',
  'priority',
  'formFields',
]);
const FIELD_KEYS = new Set(['id', 'type', 'label', 'required', 'role', 'options']);
const OPTION_KEYS = new Set(['id', 'label', 'labelId', 'priority']);
export const MAX_FORM_FIELDS = 50;
export const MAX_FIELD_OPTIONS = 50;
const MAX_TEXT = 10_000;

const invalid = (message: string): never => {
  throw new HttpError(400, `templateData: ${message}`);
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function onlyKeys(value: Record<string, unknown>, keys: Set<string>, at: string) {
  const extra = Object.keys(value).find((k) => !keys.has(k));
  if (extra) invalid(`${at}${extra} is not supported`);
}

function text(value: unknown, at: string, max: number, required: boolean): string | undefined {
  if (value === undefined || value === null) {
    if (required) invalid(`${at} is required`);
    return undefined;
  }
  if (typeof value !== 'string') return invalid(`${at} must be a string`);
  const trimmed = value.trim();
  if (required && trimmed === '') invalid(`${at} must not be empty`);
  if (value.length > max) invalid(`${at} is longer than ${max} characters`);
  return required ? trimmed : value;
}

function priority(value: unknown, at: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 4)
    return invalid(`${at} must be a whole number from 0 to 4`);
  return value;
}

function id(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 64)
    return invalid(`${at} must be a non-empty string of at most 64 characters`);
  return value;
}

function uuid(value: unknown, at: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) return invalid(`${at} is not a valid id`);
  return value;
}

function parseOption(raw: unknown, at: string): FormFieldOption {
  if (!isObject(raw)) return invalid(`${at} must be an object`);
  onlyKeys(raw, OPTION_KEYS, `${at}.`);
  const option: FormFieldOption = {
    id: id(raw.id, `${at}.id`),
    label: text(raw.label, `${at}.label`, 255, true)!,
  };
  if (raw.labelId != null) option.labelId = uuid(raw.labelId, `${at}.labelId`);
  const p = priority(raw.priority, `${at}.priority`);
  if (p !== undefined) option.priority = p;
  return option;
}

function parseField(raw: unknown, at: string): FormField {
  if (!isObject(raw)) return invalid(`${at} must be an object`);
  onlyKeys(raw, FIELD_KEYS, `${at}.`);
  if (!FIELD_TYPES.has(raw.type as FormFieldType)) invalid(`${at}.type is not a field type`);
  const type = raw.type as FormFieldType;
  if (raw.required !== undefined && typeof raw.required !== 'boolean')
    invalid(`${at}.required must be a boolean`);
  const field: FormField = {
    id: id(raw.id, `${at}.id`),
    type,
    label: text(raw.label, `${at}.label`, 255, true)!,
    required: raw.required === true,
  };
  if (raw.role != null) {
    if (raw.role === 'title' && type !== 'shortText')
      invalid(`${at}.role title needs a shortText field`);
    else if (raw.role === 'quote' && type !== 'longText')
      invalid(`${at}.role quote needs a longText field`);
    else if (raw.role !== 'title' && raw.role !== 'quote') invalid(`${at}.role is not a role`);
    field.role = raw.role as 'title' | 'quote';
  }
  const choice = type === 'select' || type === 'multiSelect';
  if (choice) {
    if (!Array.isArray(raw.options) || raw.options.length === 0)
      invalid(`${at}.options must list at least one option`);
    const options = raw.options as unknown[];
    if (options.length > MAX_FIELD_OPTIONS)
      invalid(`${at}.options has more than ${MAX_FIELD_OPTIONS} options`);
    field.options = options.map((o, i) => parseOption(o, `${at}.options[${i}]`));
    const ids = new Set(field.options.map((o) => o.id));
    if (ids.size !== field.options.length) invalid(`${at}.options has duplicate ids`);
  } else if (raw.options != null) invalid(`${at}.options is only for select fields`);
  return field;
}

// Checks and normalises an issue template's data for a team template (teamId) or a
// workspace template (null). Throws 400 on anything outside the shape above, a state
// not of the team (or any state on a workspace template), or a label that cannot go on
// the team's issues.
export async function parseIssueTemplateData(
  raw: unknown,
  teamId: string | null,
): Promise<IssueTemplateData> {
  if (!isObject(raw)) return invalid('must be an object');
  onlyKeys(raw, DATA_KEYS, '');
  const data: IssueTemplateData = {};
  const title = text(raw.title, 'title', 255, false);
  if (title !== undefined) data.title = title;
  const description = text(raw.description, 'description', MAX_TEXT * 10, false);
  if (description !== undefined) data.description = description;
  const p = priority(raw.priority, 'priority');
  if (p !== undefined) data.priority = p;

  if (raw.stateId != null) {
    const stateId = uuid(raw.stateId, 'stateId');
    if (!teamId) invalid('a workspace template cannot set a state');
    const [state] = await db
      .select({ id: workflowState.id })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.id, stateId),
          eq(workflowState.teamId, teamId!),
          isNull(workflowState.archivedAt),
        ),
      );
    if (!state) invalid("stateId must be a state of the template's team");
    data.stateId = stateId;
  }

  const optionLabelIds: string[] = [];
  if (raw.formFields != null) {
    if (!Array.isArray(raw.formFields)) invalid('formFields must be a list');
    const list = raw.formFields as unknown[];
    if (list.length > MAX_FORM_FIELDS)
      invalid(`formFields has more than ${MAX_FORM_FIELDS} fields`);
    const fields = list.map((f, i) => parseField(f, `formFields[${i}]`));
    if (new Set(fields.map((f) => f.id)).size !== fields.length)
      invalid('formFields has duplicate ids');
    for (const role of ['title', 'quote'] as const)
      if (fields.filter((f) => f.role === role).length > 1)
        invalid(`only one field may have the role ${role}`);
    for (const f of fields)
      for (const o of f.options ?? []) if (o.labelId) optionLabelIds.push(o.labelId);
    data.formFields = fields;
  }

  if (raw.labelIds != null) {
    if (!Array.isArray(raw.labelIds)) invalid('labelIds must be a list');
    data.labelIds = [
      ...new Set((raw.labelIds as unknown[]).map((v, i) => uuid(v, `labelIds[${i}]`))),
    ];
  }
  await assertTemplateLabels(teamId, [...(data.labelIds ?? []), ...optionLabelIds]);
  return data;
}

// Labels a template may name: on a team template those that may go on the team's
// issues; on a workspace template workspace labels only.
async function assertTemplateLabels(teamId: string | null, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (!teamId) {
    const rows = await db
      .select({ id: label.id })
      .from(label)
      .where(and(inArray(label.id, ids), isNull(label.teamId), eq(label.isGroup, false)));
    if (rows.length !== new Set(ids).size)
      invalid('labels of a workspace template must be workspace labels');
    return;
  }
  try {
    await assertLabelsApplicable(teamId, ids);
  } catch (err) {
    if (err instanceof HttpError) invalid(`labels: ${err.message}`);
    throw err;
  }
}

export const hasFormFields = (data: unknown): boolean =>
  isObject(data) && Array.isArray(data.formFields) && data.formFields.length > 0;
