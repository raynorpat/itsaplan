import type { Change, ChangeStatus } from './changes';

// The text of requester update emails (spec: requester updates): one round-up line per
// change, the change email listing every change with replies quoted in full, and the
// summary email. Plain text and escaped HTML, no images.

export interface SummaryText {
  // The written paragraph, when an AI endpoint wrote one (Task 4); else null.
  paragraph: string | null;
  lines: string[];
}

const STATUS_LABEL: Record<ChangeStatus, string> = {
  planned: 'Planned',
  inProgress: 'In progress',
  done: 'Done',
  closed: 'Closed',
};

const HEALTH_LABEL = { onTrack: 'On track', atRisk: 'At risk', offTrack: 'Off track' } as const;

type StatusChange = Extract<Change, { kind: 'status' }>;
type UpdateChange = Extract<Change, { kind: 'projectUpdate' }>;
type ShippedChange = Extract<Change, { kind: 'shipped' }>;

const shippedLine = (c: ShippedChange): string => `${c.title} shipped in ${c.releaseName}`;

function statusLine(c: StatusChange): string {
  if (c.to === 'closed') {
    return c.duplicateOf
      ? `${c.title} was closed as a duplicate of ${c.duplicateOf.title}`
      : `${c.title} was closed`;
  }
  if (c.from === 'done' || c.from === 'closed') {
    return `${c.title}: Reopened, ${STATUS_LABEL[c.to]}`;
  }
  return `${c.title} moved to ${STATUS_LABEL[c.to]}`;
}

function updateLine(c: UpdateChange): string {
  return c.health
    ? `${c.projectName}: ${HEALTH_LABEL[c.health]}`
    : `${c.projectName} posted an update`;
}

// One line per change, in order; replies are counted per issue on the line of the
// issue's first reply.
export function roundUp(changes: Change[]): string[] {
  const replyCounts = new Map<string, number>();
  for (const c of changes) {
    if (c.kind === 'reply') replyCounts.set(c.issueId, (replyCounts.get(c.issueId) ?? 0) + 1);
  }
  const lines: string[] = [];
  const counted = new Set<string>();
  for (const c of changes) {
    if (c.kind === 'status') lines.push(statusLine(c));
    else if (c.kind === 'projectUpdate') lines.push(updateLine(c));
    else if (c.kind === 'shipped') lines.push(shippedLine(c));
    else if (!counted.has(c.issueId)) {
      counted.add(c.issueId);
      const n = replyCounts.get(c.issueId)!;
      lines.push(`${n} new ${n === 1 ? 'reply' : 'replies'} on ${c.title}`);
    }
  }
  return lines;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A block of the email: its plain text, and the same as escaped HTML.
interface Block {
  text: string;
  html: string;
}

const para = (s: string): Block => ({
  text: s,
  html: `<p>${escape(s).replace(/\n/g, '<br>')}</p>`,
});

const link = (url: string): Block => ({
  text: url,
  html: `<p><a href="${escape(url)}">${escape(url)}</a></p>`,
});

const quote = (s: string): Block => ({
  text: s
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n'),
  html: `<blockquote>${escape(s).replace(/\n/g, '<br>')}</blockquote>`,
});

function changeBlocks(c: Change): Block[] {
  if (c.kind === 'status') {
    const blocks = [para(statusLine(c))];
    if (c.url) blocks.push(link(c.url));
    return blocks;
  }
  if (c.kind === 'shipped') {
    const blocks = [para(shippedLine(c))];
    if (c.url) blocks.push(link(c.url));
    return blocks;
  }
  if (c.kind === 'reply') {
    const blocks = [para(`${c.author} replied on ${c.title}:`), quote(c.body)];
    if (c.url) blocks.push(link(c.url));
    return blocks;
  }
  const blocks = [para(`${updateLine(c)}`)];
  if (c.body.trim()) blocks.push(quote(c.body));
  return blocks;
}

function footer(workspaceName: string, unsubscribeUrl: string): Block[] {
  return [
    para(
      `You get these emails because you asked ${workspaceName} for something. To stop them or change how often they come:`,
    ),
    link(unsubscribeUrl),
  ];
}

function assemble(
  subject: string,
  blocks: Block[],
): { subject: string; text: string; html: string } {
  return {
    subject,
    text: blocks.map((b) => b.text).join('\n\n'),
    html: blocks.map((b) => b.html).join(''),
  };
}

// The email for changes since the person's last change email.
export function renderChangeEmail(
  changes: Change[],
  person: { displayName: string },
  workspaceName: string,
  unsubscribeUrl: string,
): { subject: string; text: string; html: string } {
  return assemble('Updates on what you asked for', [
    para(`Hi ${person.displayName},`),
    para(`Here is what changed on what you asked ${workspaceName} for:`),
    ...changes.flatMap(changeBlocks),
    ...footer(workspaceName, unsubscribeUrl),
  ]);
}

// The weekly or daily summary: the written paragraph (when there is one) above the
// round-up.
export function renderSummaryEmail(
  summary: SummaryText,
  person: { displayName: string },
  workspaceName: string,
  unsubscribeUrl: string,
  cadence: 'weekly' | 'daily',
): { subject: string; text: string; html: string } {
  const blocks = [para(`Hi ${person.displayName},`)];
  if (summary.paragraph) blocks.push(para(summary.paragraph));
  else
    blocks.push(
      para(`Here is what happened on what you asked ${workspaceName} for since your last summary:`),
    );
  blocks.push({
    text: summary.lines.map((l) => `- ${l}`).join('\n'),
    html: `<ul>${summary.lines.map((l) => `<li>${escape(l)}</li>`).join('')}</ul>`,
  });
  return assemble(cadence === 'weekly' ? 'Your weekly summary' : 'Your daily summary', [
    ...blocks,
    ...footer(workspaceName, unsubscribeUrl),
  ]);
}
