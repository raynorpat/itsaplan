import type { BoardDto, BoardInput } from '../services/portalAdmin.service';

// The board editor's form: the lists are typed as text (comma or newline separated)
// and the source is a team, a project, or the requests of the board's customer.
export interface BoardForm {
  name: string;
  slug: string;
  intro: string;
  source: 'team' | 'project' | 'customerRequests';
  teamId: string;
  projectId: string;
  labelIds: string[];
  access: 'public' | 'restricted' | 'customer';
  customerId: string;
  domains: string;
  emails: string;
  showDescription: boolean;
  comments: 'portal' | 'all';
  suggestionsEnabled: boolean;
  suggestionTeamId: string;
  suggestionStateId: string;
  suggestionLabelId: string;
  enabled: boolean;
}

export const emptyBoardForm = (): BoardForm => ({
  name: '',
  slug: '',
  intro: '',
  source: 'team',
  teamId: '',
  projectId: '',
  labelIds: [],
  access: 'public',
  customerId: '',
  domains: '',
  emails: '',
  showDescription: false,
  comments: 'portal',
  suggestionsEnabled: false,
  suggestionTeamId: '',
  suggestionStateId: '',
  suggestionLabelId: '',
  enabled: true,
});

export function boardToForm(b: BoardDto): BoardForm {
  return {
    name: b.name,
    slug: b.slug,
    intro: b.intro,
    source: boardSource(b),
    teamId: b.teamId ?? '',
    projectId: b.projectId ?? '',
    labelIds: b.labelIds,
    access: b.access,
    customerId: b.customerId ?? '',
    domains: b.allowedDomains.join(', '),
    emails: b.allowedEmails.join('\n'),
    showDescription: b.showDescription,
    comments: b.comments,
    suggestionsEnabled: b.suggestionsEnabled,
    suggestionTeamId: b.suggestionTeamId ?? '',
    suggestionStateId: b.suggestionStateId ?? '',
    suggestionLabelId: b.suggestionLabelId ?? '',
    enabled: b.enabled,
  };
}

function boardSource(b: BoardDto): BoardForm['source'] {
  if (b.shows === 'customerRequests') return 'customerRequests';
  return b.projectId ? 'project' : 'team';
}

// The access shown in the board list.
export function boardAccessLabel(b: Pick<BoardDto, 'access' | 'customer'>): string {
  switch (b.access) {
    case 'public':
      return 'Public';
    case 'restricted':
      return 'Restricted';
    case 'customer':
      return b.customer ? `Customer: ${b.customer.name}` : 'No customer — not visible';
  }
}

// Comma or newline separated entries, trimmed, lowercased, without blanks or repeats.
export function parseList(text: string): string[] {
  const entries = text
    .split(/[,\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(entries)];
}

// The board's public address; `origin` defaults to this web app's.
export function portalUrl(
  slug: string,
  origin = typeof window === 'undefined' ? '' : window.location.origin,
): string {
  return `${origin}/portal/${slug}`;
}

// The same patterns the API checks (apps/api/src/portal/admin.ts).
const SLUG_RE = /^[a-z0-9-]{1,48}$/;
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function firstInvalid(list: string[], pattern: RegExp): string | undefined {
  return list.find((entry) => !pattern.test(entry));
}

// The form's problems by field; empty when it can be saved.
export function boardFormErrors(form: BoardForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = 'Enter a name';
  if (!SLUG_RE.test(form.slug)) errors.slug = 'Use 1–48 lowercase letters, digits or dashes';
  if (form.source === 'team' && !form.teamId) errors.source = 'Choose a team';
  if (form.source === 'project' && !form.projectId) errors.source = 'Choose a project';
  if (form.source === 'customerRequests' && form.access !== 'customer')
    errors.source = "This customer's requests needs Customer access";
  if (form.access === 'customer' && !form.customerId) errors.access = 'Pick a customer';
  if (form.access === 'restricted') {
    const domains = parseList(form.domains);
    const emails = parseList(form.emails);
    const badDomain = firstInvalid(domains, DOMAIN_RE);
    const badEmail = firstInvalid(emails, EMAIL_RE);
    if (badDomain) errors.domains = `"${badDomain}" is not a domain`;
    if (badEmail) errors.emails = `"${badEmail}" is not an email address`;
    if (domains.length === 0 && emails.length === 0)
      errors.access = 'Add an email domain or an address that may sign in';
  }
  if (form.suggestionsEnabled) {
    if (!form.suggestionTeamId) errors.suggestionTeamId = 'Choose the team suggestions go to';
    if (!form.suggestionStateId) errors.suggestionStateId = 'Choose the status of new suggestions';
  }
  return errors;
}

// The create / update payload. An empty suggestion label lets the API use (or
// create) the team's "Portal" label.
export function formToInput(form: BoardForm): BoardInput {
  const suggestions = form.suggestionsEnabled;
  return {
    name: form.name.trim(),
    slug: form.slug,
    intro: form.intro.trim(),
    shows: form.source === 'customerRequests' ? 'customerRequests' : 'issues',
    teamId: form.source === 'team' ? form.teamId : null,
    projectId: form.source === 'project' ? form.projectId : null,
    labelIds: form.labelIds,
    access: form.access,
    customerId: form.access === 'customer' ? form.customerId : null,
    allowedDomains: parseList(form.domains),
    allowedEmails: parseList(form.emails),
    showDescription: form.showDescription,
    comments: form.comments,
    suggestionsEnabled: suggestions,
    suggestionTeamId: suggestions ? form.suggestionTeamId : null,
    suggestionStateId: suggestions ? form.suggestionStateId : null,
    suggestionLabelId: suggestions && form.suggestionLabelId ? form.suggestionLabelId : null,
    enabled: form.enabled,
  };
}
