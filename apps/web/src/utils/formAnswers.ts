// Answers to a public form (a form link, or a form on a portal board). The field shape
// mirrors the API's public form fields: options without the labels and priority they set.

export interface PublicFormField {
  id: string;
  type: 'shortText' | 'longText' | 'select' | 'multiSelect' | 'checkbox';
  label: string;
  required: boolean;
  role?: 'title' | 'quote';
  options?: { id: string; label: string }[];
}

export type Answers = Record<string, string | string[] | boolean>;

export const MAX_ANSWER_LENGTH = 10_000;

export function emptyAnswers(fields: PublicFormField[]): Answers {
  const answers: Answers = {};
  for (const field of fields) {
    if (field.type === 'multiSelect') answers[field.id] = [];
    else if (field.type === 'checkbox') answers[field.id] = false;
    else answers[field.id] = '';
  }
  return answers;
}

function unanswered(value: Answers[string] | undefined): boolean {
  if (value === undefined || value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

// The same rules the API applies: required questions answered (a required checkbox
// ticked), text at most 10,000 characters. Keyed by field id.
export function answerErrors(fields: PublicFormField[], answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = answers[field.id];
    if (field.required && unanswered(value)) errors[field.id] = 'Required';
    else if (typeof value === 'string' && value.trim().length > MAX_ANSWER_LENGTH)
      errors[field.id] = `At most ${MAX_ANSWER_LENGTH.toLocaleString('en')} characters`;
  }
  return errors;
}

// The title question's answer, for "Is it one of these?"; '' without one.
export function titleAnswer(fields: PublicFormField[], answers: Answers): string {
  const field = fields.find((f) => f.role === 'title');
  const value = field ? answers[field.id] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}
