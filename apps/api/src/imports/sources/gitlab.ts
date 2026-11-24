import type { SourceComment, SourceData, SourceIssue, SourcePerson } from '../types';
import type { SourceRepository } from './gitea';
import { baseUrl, getJson, MAX_PAGES, sourceUrl } from './http';

// GitLab: /api/v4 with `PRIVATE-TOKEN`, pages by `page` and `per_page` with the
// `X-Next-Page` header. A project is addressed by its URL-encoded path. Issue
// descriptions and notes are Markdown; GitLab does not show users' emails to a
// non-admin token, so people come without one.

const PAGE_SIZE = 100;

interface GitlabUser {
  id: number;
  username: string;
  name?: string | null;
  public_email?: string | null;
}

interface GitlabIssue {
  iid: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed';
  web_url: string;
  labels: ({ name: string; color: string | null } | string)[];
  author: GitlabUser;
  assignee: GitlabUser | null;
  assignees: GitlabUser[] | null;
  created_at: string;
  closed_at: string | null;
  user_notes_count: number;
}

interface GitlabNote {
  id: number;
  author: GitlabUser;
  body: string;
  system: boolean;
  created_at: string;
}

const auth = (token: string) => ({ 'private-token': token });

function person(u: GitlabUser): SourcePerson {
  return {
    key: String(u.id),
    login: u.username,
    name: u.name?.trim() || null,
    email: u.public_email?.trim() || null,
  };
}

// Every page of a list, following `X-Next-Page`. Items are kept once by `key`, since a
// list that changes during the read shifts its pages.
async function allPages<T>(
  url: (page: number) => string,
  token: string,
  key: (item: T) => string | number,
): Promise<T[]> {
  const out = new Map<string | number, T>();
  for (let page = 1, reads = 0; reads < MAX_PAGES; reads += 1) {
    const { data, headers } = await getJson<T[]>(url(page), auth(token), token);
    for (const item of data) if (!out.has(key(item))) out.set(key(item), item);
    const next = Number(headers.get('x-next-page') || '');
    if (!next || next <= page) break;
    page = next;
  }
  return [...out.values()];
}

export async function listGitlabProjects(
  host: string,
  token: string,
  opts: { pageSize?: number } = {},
): Promise<SourceRepository[]> {
  const base = baseUrl(host);
  const perPage = opts.pageSize ?? PAGE_SIZE;
  const projects = await allPages<{ path_with_namespace: string }>(
    (page) =>
      `${base}/api/v4/projects?membership=true&simple=true&order_by=path&sort=asc&per_page=${perPage}&page=${page}`,
    token,
    (p) => p.path_with_namespace,
  );
  return projects.map((p) => ({ id: p.path_with_namespace, name: p.path_with_namespace }));
}

export async function fetchGitlab(
  host: string,
  token: string,
  projectPath: string,
  opts: { includeClosed: boolean; labels?: string[]; pageSize?: number },
): Promise<SourceData> {
  const base = baseUrl(host);
  const project = encodeURIComponent(projectPath);
  const perPage = opts.pageSize ?? PAGE_SIZE;
  const state = opts.includeClosed ? '' : '&state=opened';
  const labels = opts.labels?.length ? `&labels=${encodeURIComponent(opts.labels.join(','))}` : '';
  const raw = await allPages<GitlabIssue>(
    (page) =>
      `${base}/api/v4/projects/${project}/issues?issue_type=issue&with_labels_details=true&order_by=created_at&sort=asc&per_page=${perPage}&page=${page}${state}${labels}`,
    token,
    (i) => i.iid,
  );
  const issues: SourceIssue[] = [];
  for (const i of raw) {
    const comments: SourceComment[] =
      i.user_notes_count > 0
        ? (
            await allPages<GitlabNote>(
              (page) =>
                `${base}/api/v4/projects/${project}/issues/${i.iid}/notes?sort=asc&order_by=created_at&per_page=${perPage}&page=${page}`,
              token,
              (n) => n.id,
            )
          )
            .filter((n) => !n.system)
            .map((n) => ({ author: person(n.author), body: n.body ?? '', createdAt: n.created_at }))
        : [];
    const assignee = i.assignee ?? i.assignees?.[0] ?? null;
    issues.push({
      url: sourceUrl(i.web_url, base, `${base}/${projectPath}/-/issues/${i.iid}`),
      number: i.iid,
      title: i.title,
      body: i.description ?? '',
      state: i.state === 'closed' ? 'closed' : 'open',
      labels: i.labels.map((l) =>
        typeof l === 'string' ? { name: l, color: null } : { name: l.name, color: l.color ?? null },
      ),
      author: person(i.author),
      assignee: assignee ? person(assignee) : null,
      createdAt: i.created_at,
      closedAt: i.closed_at ?? null,
      comments,
    });
  }
  issues.sort((a, b) => a.number - b.number);
  return { serviceLabel: 'GitLab', issues };
}
