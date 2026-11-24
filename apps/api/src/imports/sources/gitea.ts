import type { SourceComment, SourceData, SourceIssue, SourcePerson } from '../types';
import { baseUrl, getJson } from './http';

// Gitea and Forgejo (a Gitea fork with the same API): /api/v1 with
// `Authorization: token <token>`, pages by `page` and `limit`.

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
  user: GiteaUser;
  body: string;
  created_at: string;
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

// Every page of a list endpoint; a page shorter than the page size is the last.
async function allPages<T>(
  url: (page: number, limit: number) => string,
  token: string,
  pageSize: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page += 1) {
    const { data } = await getJson<T[]>(url(page, pageSize), auth(token), token);
    out.push(...data);
    if (data.length < pageSize) return out;
  }
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
  );
  const issues: SourceIssue[] = [];
  for (const i of raw) {
    if (i.pull_request) continue;
    const comments: SourceComment[] =
      i.comments > 0
        ? (
            await allPages<GiteaComment>(
              (page, limit) =>
                `${base}/api/v1/repos/${repo}/issues/${i.number}/comments?page=${page}&limit=${limit}`,
              token,
              pageSize,
            )
          ).map((c) => ({ author: person(c.user), body: c.body ?? '', createdAt: c.created_at }))
        : [];
    const assignee = i.assignee ?? i.assignees?.[0] ?? null;
    issues.push({
      url: i.html_url,
      number: i.number,
      title: i.title,
      body: i.body ?? '',
      state: i.state === 'closed' ? 'closed' : 'open',
      labels: (i.labels ?? []).map((l) => ({ name: l.name, color: l.color ?? null })),
      author: person(i.user),
      assignee: assignee ? person(assignee) : null,
      createdAt: i.created_at,
      closedAt: i.closed_at ?? null,
      comments,
    });
  }
  issues.sort((a, b) => a.number - b.number);
  return { serviceLabel: opts.serviceLabel, issues };
}
