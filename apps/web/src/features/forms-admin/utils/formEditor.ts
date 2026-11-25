// The form editor's state and its pure helpers. A form is a team issue template
// whose `templateData` holds the questions (`formFields`, checked by the API in
// apps/api/src/templates/data.ts) plus publishing settings saved through
// /api/auth/instance/forms/settings.

export interface FormFieldOption {
  id: string;
  label: string;
  labelId?: string;
  priority?: number;
}

export interface FormField {
  id: string;
  type: 'shortText' | 'longText' | 'select' | 'multiSelect' | 'checkbox';
  label: string;
  required: boolean;
  role?: 'title' | 'quote';
  options?: FormFieldOption[];
}

export type FormRole = NonNullable<FormField['role']>;

export interface FormEditorState {
  name: string;
  teamId: string;
  stateId: string;
  labelIds: string[];
  // 0 = no priority (Linear's scale).
  priority: number;
  fields: FormField[];
  slug: string;
  intro: string;
  linkEnabled: boolean;
  boardIds: string[];
}

export const emptyFormEditor = (): FormEditorState => ({
  name: '',
  teamId: '',
  stateId: '',
  labelIds: [],
  priority: 0,
  fields: [],
  slug: '',
  intro: '',
  linkEnabled: false,
  boardIds: [],
});

const newId = () => crypto.randomUUID();

const newOption = (label: string): FormFieldOption => ({ id: newId(), label });

export const newFormOption = (): FormFieldOption => newOption('');

const hasOptions = (type: FormField['type']) => type === 'select' || type === 'multiSelect';

// A new, unlabelled, optional question; choice questions start with two options.
export function newField(type: FormField['type']): FormField {
  const field: FormField = { id: newId(), type, label: '', required: false };
  if (hasOptions(type)) field.options = [newOption('Option 1'), newOption('Option 2')];
  return field;
}

// The list with the question at `from` moved to `to`; the same list when either is
// outside it.
export function moveField(fields: FormField[], from: number, to: number): FormField[] {
  const inside = (i: number) => i >= 0 && i < fields.length;
  if (!inside(from) || !inside(to) || from === to) return fields;
  const next = [...fields];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

// The type each role needs: the title is a short text, the quote a long text.
const ROLE_TYPE: Record<FormRole, FormField['type']> = { title: 'shortText', quote: 'longText' };

const withoutRole = ({ role: _role, ...rest }: FormField): FormField => rest;

// Gives `fieldId` the role (taking it from any other question), or clears its role
// with null. A role on the wrong kind of question returns the list unchanged.
export function setRole(fields: FormField[], fieldId: string, role: FormRole | null): FormField[] {
  const target = fields.find((f) => f.id === fieldId);
  if (!target) return fields;
  if (role === null) return fields.map((f) => (f.id === fieldId ? withoutRole(f) : f));
  if (target.type !== ROLE_TYPE[role]) return fields;
  return fields.map((f) => {
    if (f.id === fieldId) return { ...f, role };
    return f.role === role ? withoutRole(f) : f;
  });
}

// The same address rules the API checks (apps/api/src/forms/admin.ts).
const SLUG_RE = /^[a-z0-9-]{1,48}$/;
const RESERVED_SLUGS = new Set(['confirm', 'confirm-info']);

// The editor's problems by field ("field:<id>" for a question); empty when it can be
// saved.
export function formEditorErrors(form: FormEditorState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = 'Enter a name';
  if (!form.teamId) errors.teamId = 'Choose a team';
  if (!SLUG_RE.test(form.slug)) errors.slug = 'Use 1–48 lowercase letters, digits or dashes';
  else if (RESERVED_SLUGS.has(form.slug)) errors.slug = 'This address is reserved';
  for (const f of form.fields) {
    const key = `field:${f.id}`;
    if (!f.label.trim()) errors[key] = 'Enter the question';
    else if (hasOptions(f.type) && (f.options ?? []).length === 0) errors[key] = 'Add an option';
    else if ((f.options ?? []).some((o) => !o.label.trim())) errors[key] = 'Name every option';
  }
  return errors;
}

// The boards a form of `teamId` may be shown on: the team's boards and the project
// boards whose project includes the team (`projectTeams`: project id → team ids).
export function eligibleBoards<B extends { teamId: string | null; projectId: string | null }>(
  boards: B[],
  teamId: string,
  projectTeams: Record<string, string[]>,
): B[] {
  if (!teamId) return [];
  return boards.filter((b) =>
    b.projectId ? (projectTeams[b.projectId] ?? []).includes(teamId) : b.teamId === teamId,
  );
}

// The stored issue template data (apps/api/src/templates/data.ts); unknown keys are
// refused by the API, so only these are written.
export interface IssueTemplateData {
  title?: string;
  description?: string;
  stateId?: string;
  labelIds?: string[];
  priority?: number;
  formFields?: FormField[];
}

export interface FormSettings {
  slug: string;
  intro: string;
  linkEnabled: boolean;
  boardIds: string[];
}

function asTemplateData(raw: unknown): IssueTemplateData {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as IssueTemplateData)
    : {};
}

// The editor's state for a stored form (template and settings), or for a template
// without settings yet (`settings` null).
export function editorFromForm(
  template: { name: string; teamId: string; templateData: unknown },
  settings: FormSettings | null,
): FormEditorState {
  const data = asTemplateData(template.templateData);
  return {
    ...emptyFormEditor(),
    name: template.name,
    teamId: template.teamId,
    stateId: data.stateId ?? '',
    labelIds: data.labelIds ?? [],
    priority: data.priority ?? 0,
    fields: data.formFields ?? [],
    ...(settings ?? {}),
  };
}

// The template data to save: the editor's state, status, labels, priority and
// questions over `existing`, which keeps the template's own title and description.
export function templateDataFromEditor(
  form: FormEditorState,
  existing: unknown = {},
): IssueTemplateData {
  const {
    stateId: _s,
    labelIds: _l,
    priority: _p,
    formFields: _f,
    ...kept
  } = asTemplateData(existing);
  const data: IssueTemplateData = { ...kept, labelIds: form.labelIds, formFields: form.fields };
  if (form.stateId) data.stateId = form.stateId;
  if (form.priority) data.priority = form.priority;
  return data;
}

// The form's public address; `origin` defaults to this web app's.
export function formUrl(
  slug: string,
  origin = typeof window === 'undefined' ? '' : window.location.origin,
): string {
  return `${origin}/forms/${slug}`;
}

// The question kinds, in the order the editor offers them.
export const FIELD_TYPES: { type: FormField['type']; label: string }[] = [
  { type: 'shortText', label: 'Short text' },
  { type: 'longText', label: 'Long text' },
  { type: 'select', label: 'Dropdown' },
  { type: 'multiSelect', label: 'Multiple choice' },
  { type: 'checkbox', label: 'Checkbox' },
];
