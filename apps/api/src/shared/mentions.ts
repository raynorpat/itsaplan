// Mentions in a comment body. A mention is stored inline in the body as
// @[Display Name](user:<userId>), so the referenced user id is stable regardless of
// later handle or name changes.

// Display names may contain anything except a closing bracket; the user id runs up
// to the closing paren.
const MENTION_RE = /@\[([^\]]*)\]\(user:([^)]+)\)/g;

// The distinct user ids mentioned in the body, in first-seen order.
export function parseMentions(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(MENTION_RE)) {
    const id = match[2]?.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}
