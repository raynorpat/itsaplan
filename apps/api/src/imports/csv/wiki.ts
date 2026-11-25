// Jira wiki markup (descriptions and comments in Jira's CSV export) as Markdown, for
// the common forms: headings, bold, italic, monospace, {code} and {noformat} blocks,
// {quote} blocks and bq. lines, links, bullet and numbered lists, tables (as plain rows)
// and images (their file name). Anything else is kept as written.

const CODE_OPEN = /^\{(code|noformat)(?::([^}|]*))?[^}]*\}$/;

function inline(text: string): string {
  const spans: string[] = [];
  let out = text.replace(/\{\{(.+?)\}\}/g, (_, code: string) => {
    spans.push(`\`${code}\``);
    return `\uE000${spans.length - 1}\uE000`;
  });
  out = out
    .replace(/!([^!\s|]+)(?:\|[^!]*)?!/g, '$1')
    // Only web and mail links stay links; any other target (javascript:, data:) is
    // dropped and the text kept.
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, (_, text: string, url: string) =>
      /^(https?|mailto):/i.test(url.trim()) ? `[${text}](${url})` : text,
    )
    .replace(/\[((?:https?|mailto):[^\]\s]+)\]/g, '<$1>')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1**$2**')
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, '$1*$2*');
  return out.replace(/\uE000(\d+)\uE000/g, (_, i: string) => spans[+i]!);
}

function line(text: string): string {
  const heading = /^h([1-6])\.\s+(.*)$/.exec(text);
  if (heading) return `${'#'.repeat(+heading[1]!)} ${inline(heading[2]!)}`;
  const quote = /^bq\.\s+(.*)$/.exec(text);
  if (quote) return `> ${inline(quote[1]!)}`;
  const list = /^([*#]+)\s+(.*)$/.exec(text);
  if (list) {
    const marks = list[1]!;
    const numbered = marks.endsWith('#');
    const indent = ' '.repeat((marks.length - 1) * (numbered ? 3 : 2));
    return `${indent}${numbered ? '1.' : '-'} ${inline(list[2]!)}`;
  }
  if (/^\|.*\|$/.test(text.trim()))
    return text
      .trim()
      .replace(/^\|\|?|\|\|?$/g, '')
      .split(/\|\|?/)
      .map((cell) => inline(cell.trim()))
      .join(' | ');
  return inline(text);
}

export function wikiToMarkdown(text: string): string {
  const out: string[] = [];
  let code: string | null = null;
  let quoted = false;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = raw.trim();
    if (code !== null) {
      if (trimmed === `{${code}}`) {
        out.push('```');
        code = null;
      } else out.push(raw);
      continue;
    }
    const open = CODE_OPEN.exec(trimmed);
    if (open) {
      code = open[1]!;
      out.push(`\`\`\`${open[1] === 'code' ? (open[2]?.trim() ?? '') : ''}`);
      continue;
    }
    if (trimmed === '{quote}') {
      quoted = !quoted;
      continue;
    }
    out.push(quoted ? `> ${line(raw)}` : line(raw));
  }
  if (code !== null) out.push('```');
  return out.join('\n');
}
