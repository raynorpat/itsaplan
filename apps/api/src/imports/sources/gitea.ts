import type { SourceComment, SourceData, SourceIssue, SourcePerson } from '../types';
import { baseUrl, getJson, MAX_PAGES, sourceUrl } from './http';

// Gitea and Forgejo (a Gitea fork with the same API): /api/v1 with
// `Authorization: token <token>`, pages by `page` and `limit` with the list's size in
// `X-Total-Count`. An issue's own comments endpoint takes no paging (it always answers
// every comment), so comments are read from the repository's paged comment list and
// grouped by issue.

const PAGE_SIZE = 50;

interface GiteaUser {
  id: number;
  login: string;
  full_name?: string | null;
  email?: string | null;
}

interface GiteaIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  html_url: string;
  labels: { name: string; color: string | null }[] | null;
  user: GiteaUser;
  assignee: GiteaUser | null;
  assignees: GiteaUser[] | null;
  created_at: string;
  closed_at: string | null;
  comments: number;
  pull_request: unknown;
}

interface GiteaComment {
  id: number;
  user: GiteaUser;
  body: string | null;
  created_at: string;
  // The API URL of the issue (or pull request) it is on, ending in its number.
  issue_url: string | null;
}

export interface SourceRepository {
  id: string;
  name: string;
}

const auth = (token: string) => ({ authorization: `token ${token}` });

function person(u: GiteaUser): SourcePerson {
  return {
    key: String(u.id),
    login: u.login,
    name: u.full_name?.trim() || null,
    email: u.email?.trim() || null,
  };
}

// Every page of a list endpoint. The list ends at an empty page, once `X-Total-Count`
// items were read, or (without that header) at a page shorter than asked; a server may
// page shorter than asked (its own MAX_RESPONSE_ITEMS), which the count covers. Items
// are kept once by `key`, since a list that changes during the read shifts its pages.
async function allPages<T>(
  url: (page: number, limit: number) => string,
  token: string,
  pageSize: number,
  key: (item: T) => string | number,
): Promise<T[]> {
  const out = new Map<string | number, T>();
  let read = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, headers } = await getJson<T[]>(url(page, pageSize), auth(token), token);
    for (const item of data) if (!out.has(key(item))) out.set(key(item), item);
    read += data.length;
    const total = Number(headers.get('x-total-count') ?? '');
    if (data.length === 0) break;
    if (Number.isFinite(total) && total > 0 ? read >= total : data.length < pageSize) break;
  }
  return [...out.values()];
}

// The repositories the token can see, by "owner/name".
export async function listGiteaRepos(
  host: string,
  token: string,
  opts: { pageSize?: number } = {},
): Promise<SourceRepository[]> {
  const base = baseUrl(host);
  const repos = await allPages<{ full_name: string }>(
    (page, limit) => `${base}/api/v1/user/repos?page=${page}&limit=${limit}`,
    token,
    opts.pageSize ?? PAGE_SIZE,
    (r) => r.full_name,
  );
  return repos.map((r) => ({ id: r.full_name, name: r.full_name }));
}

export async function fetchGitea(
  host: string,
  token: string,
  repository: string,
  opts: {
    includeClosed: boolean;
    labels?: string[];
    serviceLabel: 'Gitea' | 'Forgejo';
    pageSize?: number;
  },
): Promise<SourceData> {
  const base = baseUrl(host);
  const repo = repository
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const state = opts.includeClosed ? 'all' : 'open';
  const labels = opts.labels?.length ? `&labels=${encodeURIComponent(opts.labels.join(','))}` : '';
  const raw = await allPages<GiteaIssue>(
    (page, limit) =>
      `${base}/api/v1/repos/${repo}/issues?type=issues&state=${state}&page=${page}&limit=${limit}${labels}`,
    token,
    pageSize,
    (i) => i.number,
  );
  const wanted = raw.filter((i) => !i.pull_request);
  const comments = new Map<number, GiteaComment[]>();
  if (wanted.some((i) => i.comments > 0)) {
    const all = await allPages<GiteaComment>(
      (page, limit) => `${base}/api/v1/repos/${repo}/issues/comments?page=${page}&limit=${limit}`,
      token,
      pageSize,
      (c) => c.id,
    );
    for (const c of all) {
      const n = Number(/\/(\d+)$/.exec(c.issue_url ?? '')?.[1]);
      if (!n) continue;
      comments.set(n, [...(comments.get(n) ?? []), c]);
    }
  }
  const issues: SourceIssue[] = [];
  for (const i of wanted) {
    const own: SourceComment[] = (comments.get(i.number) ?? [])
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
      .map((c) => ({ author: person(c.user), body: c.body ?? '', createdAt: c.created_at }));
    const assignee = i.assignee ?? i.assignees?.[0] ?? null;
    issues.push({
      url: sourceUrl(i.html_url, base, `${base}/${repository}/issues/${i.number}`),
      number: i.number,
      title: i.title,
      body: i.body ?? '',
      state: i.state === 'closed' ? 'closed' : 'open',
      labels: (i.labels ?? []).map((l) => ({ name: l.name, color: l.color ?? null })),
      author: person(i.user),
      assignee: assignee ? person(assignee) : null,
      createdAt: i.created_at,
      closedAt: i.closed_at ?? null,
      comments: own,
    });
  }
  issues.sort((a, b) => a.number - b.number);
  return { serviceLabel: opts.serviceLabel, issues };
}
