import { Elysia, t } from 'elysia';
import { noContent } from '../shared/http';
import { guards } from '../shared/guards';
import { authContext } from '../shared/auth-context';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import { MAX_SKILL_BYTES, importGithubSkill, discoverGithubSkills } from './skill-format';
import {
  listSkills,
  getSkill,
  getSkillMarkdown,
  getSkillRefContent,
  createSkill,
  createSkillFromFiles,
  updateSkill,
  deleteSkill,
  addReference,
  updateReference,
  deleteReference,
  listAgentSkills,
  setAgentSkills,
  agentInTeam,
} from './store';

const skillParams = t.Object({ teamKey: t.String(), skillId: t.String({ format: 'uuid' }) });
const agentParams = t.Object({ teamKey: t.String(), agentId: t.String({ format: 'uuid' }) });

const SkillRefSchema = t.Object({
  path: t.String(),
  s3Key: t.String(),
  size: t.Number(),
});

const SkillResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.String({ format: 'uuid' }),
  name: t.String(),
  description: t.String(),
  source: t.Union([t.Literal('upload'), t.Literal('inline'), t.Literal('github')]),
  sourceUrl: t.Nullable(t.String()),
  files: t.Array(SkillRefSchema),
  createdAt: t.String(),
});

// Reference-file bytes are capped like the skill markdown.
const MAX_REF_BYTES = MAX_SKILL_BYTES;

// Gated under the agent_skills resource (the team skill library).
export const agentSkillRoutes = new Elysia({
  name: 'agent-skills',
  detail: { tags: ['Agent Skills'] },
})
  .use(authContext)
  .use(guards)

  .get('/teams/:teamKey/agent-skills', ({ team }) => listSkills(team.id), {
    permission: ['agent_skills', 'read'],
    response: {
      200: t.Array(SkillResponse),
      401: ErrorResponse,
      403: ErrorResponse,
      404: ErrorResponse,
    },
    detail: { summary: 'List agent skills', description: "List the team's skill library." },
  })

  .get(
    '/teams/:teamKey/agent-skills/:skillId',
    async ({ params, team }) => {
      const skill = await getSkill(params.skillId, team.id);
      if (!skill) throw new HttpError(404, 'Skill not found');
      return skill;
    },
    {
      params: skillParams,
      permission: ['agent_skills', 'read'],
      response: {
        200: SkillResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Get an agent skill', description: "Get a skill's metadata and files." },
    },
  )

  // The full SKILL.md content, for the editor and to display the skill.
  .get(
    '/teams/:teamKey/agent-skills/:skillId/markdown',
    async ({ params, team }) => {
      const markdown = await getSkillMarkdown(params.skillId, team.id);
      return { markdown };
    },
    {
      params: skillParams,
      permission: ['agent_skills', 'read'],
      response: {
        200: t.Object({ markdown: t.String() }),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Get skill markdown', description: "Get a skill's SKILL.md content." },
    },
  )

  // The text content of one reference file, for the editor. Addressed by its
  // relative path (the same `path` carried in the skill's files list).
  .get(
    '/teams/:teamKey/agent-skills/:skillId/references/content',
    async ({ params, team, query }) => {
      const content = await getSkillRefContent(params.skillId, team.id, query.path);
      return { content };
    },
    {
      params: skillParams,
      query: t.Object({ path: t.String() }),
      permission: ['agent_skills', 'read'],
      response: {
        200: t.Object({ content: t.String() }),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get reference file content',
        description: "Get one of a skill's reference files by path.",
      },
    },
  )

  // Lists the skills found at a GitHub URL (a repo, a folder, or a file) without
  // importing anything, so the UI can let the user pick which ones to add. Each
  // result carries a ready-to-import URL for that single skill.
  .post(
    '/teams/:teamKey/agent-skills/github/discover',
    ({ body }) => discoverGithubSkills(body.url),
    {
      body: t.Object({ url: t.String() }),
      permission: ['agent_skills', 'create'],
      response: {
        200: t.Array(
          t.Object({
            name: t.String(),
            description: t.String(),
            subpath: t.String(),
            url: t.String(),
          }),
        ),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        502: ErrorResponse,
      },
      detail: {
        summary: 'Discover GitHub skills',
        description: 'List the skills at a GitHub URL (repo, folder, or file) without importing.',
      },
    },
  )

  // Creates a skill. For source "inline"/"upload" the SKILL.md text is passed in
  // `markdown`; for "github" the SKILL.md and its markdown references are fetched
  // from `sourceUrl`. name and description default to the SKILL.md frontmatter when
  // omitted.
  .post(
    '/teams/:teamKey/agent-skills',
    async ({ team, body, set }) => {
      // GitHub import: the SKILL.md and its markdown reference files are fetched from
      // the folder and stored together.
      if (body.source === 'github') {
        if (!body.sourceUrl)
          throw new HttpError(400, 'A GitHub URL is required for a github skill');
        const imported = await importGithubSkill(body.sourceUrl);
        if (imported.markdown.length > MAX_SKILL_BYTES) {
          throw new HttpError(413, 'Skill markdown is too large');
        }
        set.status = 201;
        return createSkillFromFiles(team.id, {
          name: body.name ?? null,
          description: body.description ?? null,
          markdown: imported.markdown,
          source: 'github',
          sourceUrl: body.sourceUrl,
          refs: imported.refs,
        });
      }

      const markdown = body.markdown ?? '';
      if (!markdown.trim()) throw new HttpError(400, 'Skill markdown is required');
      if (markdown.length > MAX_SKILL_BYTES)
        throw new HttpError(413, 'Skill markdown is too large');
      set.status = 201;
      return createSkill(team.id, {
        name: body.name ?? null,
        description: body.description ?? null,
        markdown,
        source: body.source,
        sourceUrl: body.sourceUrl ?? null,
      });
    },
    {
      body: t.Object({
        source: t.Union([t.Literal('upload'), t.Literal('inline'), t.Literal('github')]),
        name: t.Optional(t.Nullable(t.String())),
        description: t.Optional(t.Nullable(t.String())),
        markdown: t.Optional(t.String()),
        sourceUrl: t.Optional(t.Nullable(t.String())),
      }),
      permission: ['agent_skills', 'create'],
      response: {
        201: SkillResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
        413: ErrorResponse,
        502: ErrorResponse,
      },
      detail: {
        summary: 'Create an agent skill',
        description: 'Create a skill from inline markdown or a GitHub URL.',
      },
    },
  )

  .patch(
    '/teams/:teamKey/agent-skills/:skillId',
    async ({ params, team, body }) => {
      if (body.markdown !== undefined && body.markdown.length > MAX_SKILL_BYTES) {
        throw new HttpError(413, 'Skill markdown is too large');
      }
      const skill = await updateSkill(params.skillId, team.id, body);
      if (!skill) throw new HttpError(404, 'Skill not found');
      return skill;
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        description: t.Optional(t.String()),
        markdown: t.Optional(t.String()),
      }),
      params: skillParams,
      permission: ['agent_skills', 'edit'],
      response: {
        200: SkillResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
        413: ErrorResponse,
      },
      detail: {
        summary: 'Update an agent skill',
        description: "Update a skill's name, description, or markdown.",
      },
    },
  )

  .delete(
    '/teams/:teamKey/agent-skills/:skillId',
    async ({ params, team }) => {
      const ok = await deleteSkill(params.skillId, team.id);
      if (!ok) throw new HttpError(404, 'Skill not found');
      return noContent();
    },
    {
      params: skillParams,
      permission: ['agent_skills', 'delete'],
      response: {
        204: t.Void(),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Delete an agent skill', description: 'Delete a skill and its files.' },
    },
  )

  // Uploads a reference file (multipart "file" field). Executable file types are
  // rejected — a skill carries knowledge, not runnable scripts.
  .post(
    '/teams/:teamKey/agent-skills/:skillId/references',
    async ({ params, team, body }) => {
      const file = body.file;
      if (!(file instanceof File)) throw new HttpError(400, 'No file uploaded (form field "file")');
      if (file.size === 0) throw new HttpError(400, 'Uploaded file is empty');
      if (file.size > MAX_REF_BYTES) throw new HttpError(413, 'Reference file is too large');
      const bytes = Buffer.from(await file.arrayBuffer());
      const skill = await addReference(
        params.skillId,
        team.id,
        file.name || 'file',
        bytes,
        file.type || 'application/octet-stream',
      );
      if (!skill) throw new HttpError(404, 'Skill not found');
      return skill;
    },
    {
      body: t.Object({ file: t.File() }),
      params: skillParams,
      permission: ['agent_skills', 'edit'],
      response: {
        200: SkillResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        413: ErrorResponse,
      },
      detail: {
        summary: 'Add a reference file',
        description: 'Add a reference file to a skill.',
      },
    },
  )

  // Overwrites the text content of an existing reference file (the editor's save).
  .patch(
    '/teams/:teamKey/agent-skills/:skillId/references/content',
    async ({ params, team, body }) => {
      const bytes = Buffer.from(body.content, 'utf8');
      if (bytes.length > MAX_REF_BYTES) throw new HttpError(413, 'Reference file is too large');
      const skill = await updateReference(
        params.skillId,
        team.id,
        body.path,
        bytes,
        'text/markdown',
      );
      if (!skill) throw new HttpError(404, 'Skill not found');
      return skill;
    },
    {
      body: t.Object({ path: t.String(), content: t.String() }),
      params: skillParams,
      permission: ['agent_skills', 'edit'],
      response: {
        200: SkillResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        413: ErrorResponse,
      },
      detail: {
        summary: 'Update reference file content',
        description: "Update a skill's reference file by path.",
      },
    },
  )

  .delete(
    '/teams/:teamKey/agent-skills/:skillId/references',
    async ({ params, team, query }) => {
      const skill = await deleteReference(params.skillId, team.id, query.path);
      if (!skill) throw new HttpError(404, 'Skill not found');
      return skill;
    },
    {
      params: skillParams,
      query: t.Object({ path: t.String() }),
      permission: ['agent_skills', 'edit'],
      response: {
        200: SkillResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete a reference file',
        description: "Delete a skill's reference file by path.",
      },
    },
  )

  // Which skills are enabled on an agent.
  .get(
    '/teams/:teamKey/ai-agents/:agentId/skills',
    async ({ params, team }) => {
      if (!(await agentInTeam(params.agentId, team.id))) {
        throw new HttpError(404, 'Agent not found');
      }
      return listAgentSkills(params.agentId);
    },
    {
      params: agentParams,
      permission: ['agent_skills', 'read'],
      response: {
        200: t.Array(SkillResponse),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: "List an agent's enabled skills",
        description: 'List the skills enabled on an agent.',
      },
    },
  )

  // Replaces the set of skills enabled on an agent.
  .put(
    '/teams/:teamKey/ai-agents/:agentId/skills',
    async ({ params, team, body }) => {
      if (!(await agentInTeam(params.agentId, team.id))) {
        throw new HttpError(404, 'Agent not found');
      }
      await setAgentSkills(params.agentId, team.id, body.skillIds);
      return listAgentSkills(params.agentId);
    },
    {
      body: t.Object({ skillIds: t.Array(t.String({ format: 'uuid' })) }),
      params: agentParams,
      permission: ['agent_skills', 'edit'],
      response: {
        200: t.Array(SkillResponse),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: "Set an agent's enabled skills",
        description: 'Replace the set of skills enabled on an agent.',
      },
    },
  );
