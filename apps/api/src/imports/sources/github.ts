import { createPrivateKey, sign } from 'node:crypto';
import { HttpError } from '../../shared/lib';
import type { SourceComment, SourceData, SourceIssue, SourcePerson } from '../types';
import { getJson, MAX_PAGES, nextLink, postJson, sourceUrl } from './http';

// GitHub through this instance's GitHub Import App (Linear's model): the app's key
// signs a JWT, which mints an installation token for the repositories the workspace
// installed it on. The OAuth code of the installation confirms the person connecting
// can access that installation; their user token is used once and dropped. No GitHub
// token is stored; installation tokens are kept in memory until they expire.

const PAGE_SIZE = 100;
const API_VERSION = { 'x-github-api-version': '2022-11-28' };

export const NOT_SET_UP = 'GitHub imports are not set up on this instance';

export interface GithubConfig {
  appId: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  apiUrl: string;
  webUrl: string;
}

// The app's settings from the environment (read on each call), or null when any is
// missing. `GITHUB_IMPORT_API_URL` / `GITHUB_IMPORT_WEB_URL` default to github.com.
export function githubConfig(): GithubConfig | null {
  const e = process.env;
  const appId = e.GITHUB_IMPORT_APP_ID?.trim();
  const appSlug = e.GITHUB_IMPORT_APP_SLUG?.trim();
  const clientId = e.GITHUB_IMPORT_CLIENT_ID?.trim();
  const clientSecret = e.GITHUB_IMPORT_CLIENT_SECRET?.trim();
  // An env file holds the PEM on one line with escaped newlines.
  const privateKey = e.GITHUB_IMPORT_PRIVATE_KEY?.trim().replace(/\\n/g, '\n');
  if (!appId || !appSlug || !clientId || !clientSecret || !privateKey) return null;
  return {
    appId,
    appSlug,
    clientId,
    clientSecret,
    privateKey,
    apiUrl: (e.GITHUB_IMPORT_API_URL?.trim() || 'https://api.github.com').replace(/\/+$/, ''),
    webUrl: (e.GITHUB_IMPORT_WEB_URL?.trim() || 'https://github.com').replace(/\/+$/, ''),
  };
}

export function requireGithubConfig(): GithubConfig {
  const config = githubConfig();
  if (!config) throw new HttpError(400, NOT_SET_UP);
  return config;
}

// The app's JWT (RS256, ten minutes at most, issued a minute early for clock drift).
function appJwt(config: GithubConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const part = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: config.appId })}`;
  let key;
  try {
    key = createPrivateKey(config.privateKey);
  } catch {
    throw new HttpError(400, 'The GitHub Import App private key is not a valid PEM key');
  }
  return `${unsigned}.${sign('sha256', Buffer.from(unsigned), key).toString('base64url')}`;
}

// Installation tokens by installation id, until a minute before they expire.
const installationTokens = new Map<string, { token: string; expiresAt: number }>();

async function installationToken(config: GithubConfig, installationId: string): Promise<string> {
  const cached = installationTokens.get(installationId);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const jwt = appJwt(config);
  const { data } = await postJson<{ token: string; expires_at: string }>(
    `${config.apiUrl}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    { authorization: `Bearer ${jwt}`, ...API_VERSION },
    undefined,
    jwt,
  );
  installationTokens.set(installationId, {
    token: data.token,
    expiresAt: Date.parse(data.expires_at),
  });
  return data.token;
}

// Confirms that the person who authorized the app (the OAuth code GitHub sent back
// after the installation) can access `installationId`. Their token is discarded.
export async function confirmInstallation(code: string, installationId: string): Promise<void> {
  const config = requireGithubConfig();
  const { data } = await postJson<{ access_token?: string; error?: string }>(
    `${config.webUrl}/login/oauth/access_token`,
    {},
    { client_id: config.clientId, client_secret: config.clientSecret, code },
    config.clientSecret,
  );
  const userToken = data.access_token;
  if (!userToken) throw new HttpError(400, 'GitHub did not accept the authorization code');
  const installations: { id: number }[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data: res } = await getJson<{ installations: { id: number }[] }>(
      `${config.apiUrl}/user/installations?per_page=${PAGE_SIZE}&page=${page}`,
      { authorization: `Bearer ${userToken}`, ...API_VERSION },
      userToken,
    );
    installations.push(...res.installations);
    if (res.installations.length < PAGE_SIZE) break;
  }
  if (!installations.some((i) => String(i.id) === installationId))
    throw new HttpError(400, 'Your GitHub account cannot access this installation');
}

export interface GithubRepository {
  id: number;
  name: string;
}

async function installationGet<T>(
  config: GithubConfig,
  installationId: string,
  path: string,
): Promise<{ data: T; headers: Headers }> {
  const token = await installationToken(config, installationId);
  return getJson<T>(
    `${config.apiUrl}${path}`,
    { authorization: `Bearer ${token}`, ...API_VERSION },
    token,
  );
}

// The repositories the installation can see.
export async function listGithubRepos(installationId: string): Promise<GithubRepository[]> {
  const config = requireGithubConfig();
  const out: GithubRepository[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await installationGet<{
      repositories: { id: number; full_name: string }[];
    }>(config, installationId, `/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`);
    out.push(...data.repositories.map((r) => ({ id: r.id, name: r.full_name })));
    if (data.repositories.length < PAGE_SIZE) break;
  }
  return out;
}

interface GithubUser {
  id: number;
  login: string;
}

interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  state_reason: string | null;
  html_url: string;
  labels: ({ name: string; color: string | null } | string)[];
  user: GithubUser;
  assignee: GithubUser | null;
  created_at: string;
  closed_at: string | null;
  comments: number;
  pull_request?: unknown;
}

interface GithubComment {
  id: number;
  // The API URL of the issue (or pull request) it is on, ending in its number.
  issue_url: string;
  user: GithubUser;
  body: string | null;
  created_at: string;
}

// Every page of a list, following GitHub's `Link: rel="next"`. Items are kept once by `key`, since a list that changes
// during the read shifts its pages.
async function allPages<T>(
  config: GithubConfig,
  installationId: string,
  path: string,
  key: (item: T) => number,
): Promise<T[]> {
  const out = new Map<number, T>();
  let next: string | null = `${path}${path.includes('?') ? '&' : '?'}per_page=${PAGE_SIZE}&page=1`;
  for (let reads = 0; next && reads < MAX_PAGES; reads += 1) {
    const { data, headers } = await installationGet<T[]>(config, installationId, next);
    for (const item of data) if (!out.has(key(item))) out.set(key(item), item);
    const link = nextLink(headers);
    // The Link header holds an absolute URL; keep its path and query.
    next = link ? link.slice(new URL(link).origin.length) : null;
  }
  return [...out.values()];
}

// GitHub's "closed as not planned" is its own state, which the engine maps to canceled.
function issueState(i: GithubIssue): SourceIssue['state'] {
  if (i.state === 'open') return 'open';
  return i.state_reason === 'not_planned' ? 'notPlanned' : 'closed';
}

// Fetches the issues (no pull requests) of the given repositories, oldest first, with
// their comments read from the repository's comment list (one request per 100
// comments, not one per issue). The lists carry only a user's id and login, so each
// person's profile is read once for the name and the public email the people matching
// uses.
export async function fetchGithub(
  installationId: string,
  repositories: GithubRepository[],
  opts: { includeClosed: boolean; labels?: string[] },
): Promise<SourceData> {
  const config = requireGithubConfig();
  const state = opts.includeClosed ? 'all' : 'open';
  const labels = opts.labels?.length ? `&labels=${encodeURIComponent(opts.labels.join(','))}` : '';
  const profiles = new Map<string, SourcePerson>();
  const person = async (u: GithubUser): Promise<SourcePerson> => {
    const known = profiles.get(u.login);
    if (known) return known;
    const { data } = await installationGet<{ name: string | null; email: string | null }>(
      config,
      installationId,
      `/users/${encodeURIComponent(u.login)}`,
    );
    const p: SourcePerson = {
      key: String(u.id),
      login: u.login,
      name: data.name?.trim() || null,
      email: data.email?.trim() || null,
    };
    profiles.set(u.login, p);
    return p;
  };

  const issues: SourceIssue[] = [];
  for (const repository of repositories) {
    const repo = repository.name
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    const raw = (
      await allPages<GithubIssue>(
        config,
        installationId,
        `/repos/${repo}/issues?state=${state}&sort=created&direction=asc${labels}`,
        (i) => i.number,
      )
    ).filter((i) => !i.pull_request);
    const byIssue = new Map<number, GithubComment[]>();
    if (raw.some((i) => i.comments > 0)) {
      const rows = await allPages<GithubComment>(
        config,
        installationId,
        `/repos/${repo}/issues/comments?sort=created&direction=asc`,
        (c) => c.id,
      );
      for (const c of rows) {
        const n = Number(/\/(\d+)$/.exec(c.issue_url)?.[1]);
        if (n) byIssue.set(n, [...(byIssue.get(n) ?? []), c]);
      }
    }
    for (const i of raw) {
      const comments: SourceComment[] = [];
      for (const c of byIssue.get(i.number) ?? [])
        comments.push({
          author: await person(c.user),
          body: c.body ?? '',
          createdAt: c.created_at,
        });
      issues.push({
        url: sourceUrl(
          i.html_url,
          config.webUrl,
          `${config.webUrl}/${repository.name}/issues/${i.number}`,
        ),
        number: i.number,
        title: i.title,
        body: i.body ?? '',
        state: issueState(i),
        labels: i.labels.map((l) =>
          typeof l === 'string' ? { name: l, color: null } : { name: l.name, color: l.color },
        ),
        author: await person(i.user),
        assignee: i.assignee ? await person(i.assignee) : null,
        createdAt: i.created_at,
        closedAt: i.closed_at,
        comments,
      });
    }
  }
  return { serviceLabel: 'GitHub', issues };
}
