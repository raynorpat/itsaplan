import {
  db,
  team,
  teamMember,
  teamRole,
  workflowState,
  issueType,
  labelGroup,
  label,
  customField,
  customFieldOption,
  teamView,
  teamDashboard,
  teamAction,
  integrationCredential,
  agentTool,
  webhook,
  teamNotificationSetting,
  teamSetting,
} from '@repo/db';
import { eq, inArray } from 'drizzle-orm';
import { iso } from '../shared/lib';
import { defaultMemberPermissions } from '../shared/permissions';
import { DEFAULT_COLUMNS, type TeamRow } from './store';
import { listAgents, createAgent, type NewAgentInput } from '../ai-agents/store';
import {
  listSkills,
  getSkillMarkdown,
  createSkillFromFiles,
  setAgentSkills,
  listAgentSkills,
} from '../agent-skills/store';
import { listAgentToolLinks, setAgentTools } from '../agent-tools/store';
import { listAgentSchedules, createAgentSchedule } from '../agent-schedules/store';
import { nextCronRun } from '../agent-schedules/cron';
import { getObject } from '../shared/s3';

// Which parts of a source team the copy carries over. Each key mirrors a section
// of the team settings menu. A key set false skips that entity. Some sections
// depend on others (a view's filters reference states/types/labels/fields); those
// dependencies are force-enabled in normalizeInclude so a partial selection can
// never leave an id pointing at the source team.
export interface CopyTeamInclude {
  states: boolean;
  issueTypes: boolean;
  labels: boolean;
  customFields: boolean;
  views: boolean;
  dashboards: boolean;
  actions: boolean;
  archive: boolean;
  roles: boolean;
  notificationProviders: boolean;
  webhooks: boolean;
  integrations: boolean;
  tools: boolean;
  skills: boolean;
  agents: boolean;
  schedules: boolean;
}

export const COPY_INCLUDE_KEYS: (keyof CopyTeamInclude)[] = [
  'states',
  'issueTypes',
  'labels',
  'customFields',
  'views',
  'dashboards',
  'actions',
  'archive',
  'roles',
  'notificationProviders',
  'webhooks',
  'integrations',
  'tools',
  'skills',
  'agents',
  'schedules',
];

const ALL_FALSE = Object.fromEntries(
  COPY_INCLUDE_KEYS.map((k) => [k, false]),
) as unknown as CopyTeamInclude;

// The set copied when a caller sends no selection (MCP and any older client). This
// is the team structure the copy carried before the selection was added.
const DEFAULT_INCLUDE: CopyTeamInclude = {
  ...ALL_FALSE,
  states: true,
  issueTypes: true,
  labels: true,
  customFields: true,
  views: true,
  dashboards: true,
  actions: true,
};

// Resolves the selection and force-enables the dependencies each entity needs to be
// copied correctly. Views/actions remap the ids of states, types, labels and fields,
// so those must be copied too; a tool cannot exist without its credential; a schedule
// cannot exist without its agent.
function normalizeInclude(raw?: Partial<CopyTeamInclude>): CopyTeamInclude {
  const inc: CopyTeamInclude = raw ? { ...ALL_FALSE, ...raw } : { ...DEFAULT_INCLUDE };
  if (inc.customFields) inc.issueTypes = true;
  if (inc.views) {
    inc.states = true;
    inc.issueTypes = true;
    inc.labels = true;
    inc.customFields = true;
  }
  if (inc.actions) {
    inc.states = true;
    inc.issueTypes = true;
    inc.labels = true;
  }
  if (inc.tools) inc.integrations = true;
  if (inc.schedules) inc.agents = true;
  return inc;
}

// Old id → new id maps built while copying, used to rewrite the id references that
// views and actions hold in their filters.
interface CopyIdMaps {
  column: Map<string, string>;
  labelGroup: Map<string, string>;
  label: Map<string, string>;
  type: Map<string, string>;
  field: Map<string, string>;
  option: Map<string, string>;
}

// Returns the mapped id for an id present in the map; any other value passes
// through unchanged.
function remapId(map: Map<string, string>, v: unknown): unknown {
  return typeof v === 'string' && map.has(v) ? map.get(v) : v;
}

// Rewrites the entity ids a view's filter set references so they point at the copied
// team's entities. The display blob's ids (hiddenGroups) are remapped separately
// by remapViewDisplay.
//
// The filter shape is owned by the UI: a FilterSet is { conditions: [{ field, op,
// values }] }. Which map a condition's id values use is decided by its field:
// status → column, type → type, labels → label, cf:<fieldId> → the field id is
// remapped in the key, and select values are option ids, so they use the option map.
// Other values (priorities, statusType strings, assignee user ids, dates,
// custom-field text) are left as-is. Values whose id is absent from the map are kept
// unchanged.
function remapViewFilters(filters: unknown, maps: CopyIdMaps): unknown {
  if (!filters || typeof filters !== 'object') return filters;
  const conditions = (filters as { conditions?: unknown }).conditions;
  if (!Array.isArray(conditions)) return filters;

  const newConditions = conditions.map((cond: Record<string, unknown>) => {
    if (!cond || typeof cond !== 'object') return cond;
    const field: unknown = cond.field;
    let newField = field;
    let valueMap: Map<string, string> | null = null;

    if (field === 'status') valueMap = maps.column;
    else if (field === 'type') valueMap = maps.type;
    else if (field === 'labels') valueMap = maps.label;
    else if (typeof field === 'string' && field.startsWith('cf:')) {
      const newFieldId = maps.field.get(field.slice(3));
      if (newFieldId != null) newField = `cf:${newFieldId}`;
      valueMap = maps.option;
    }

    const values =
      valueMap && Array.isArray(cond.values)
        ? cond.values.map((v: unknown) => remapId(valueMap!, v))
        : cond.values;
    return { ...cond, field: newField, values };
  });

  return { ...(filters as object), conditions: newConditions };
}

// Remaps one work items group key to the copied team's entities. Group keys are
// namespaced by grouping field: c<stateId> and t<typeId> carry a team-scoped id
// and are remapped; a<userId> (assignee), p<priority>, the *-none buckets and 'all'
// carry none and pass through.
function remapGroupKey(key: string, maps: CopyIdMaps): string {
  const m = /^([ct])([0-9a-f-]{36})$/i.exec(key);
  if (!m) return key;
  const id = m[2];
  const map = m[1] === 'c' ? maps.column : maps.type;
  const newId = map.get(id);
  return newId != null ? `${m[1]}${newId}` : key;
}

// Rewrites the id-bearing parts of a view's display blob. Only hiddenGroups holds ids
// (group keys of the flat work items view's hidden columns); the rest of the display
// (layout, sort, group/subgroup, properties) is field-kind enums, copied as-is.
function remapViewDisplay(display: unknown, maps: CopyIdMaps): unknown {
  if (!display || typeof display !== 'object') return display;
  const hidden = (display as { hiddenGroups?: unknown }).hiddenGroups;
  if (!Array.isArray(hidden)) return display;
  return {
    ...(display as object),
    hiddenGroups: hidden.map((k: unknown) => (typeof k === 'string' ? remapGroupKey(k, maps) : k)),
  };
}

// Rewrites the entity ids an action's effect holds so they point at the copied
// team's entities. The effect is a partial issue patch; stateId/typeId and each
// labelId are remapped, while assigneeUserId (a global user id), priority and dates
// are left as-is.
function remapActionEffect(effect: unknown, maps: CopyIdMaps): unknown {
  if (!effect || typeof effect !== 'object') return effect;
  const src = effect as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  if ('stateId' in src) out.stateId = remapId(maps.column, src.stateId);
  if ('typeId' in src) out.typeId = remapId(maps.type, src.typeId);
  if (Array.isArray(src.labelIds)) out.labelIds = src.labelIds.map((v) => remapId(maps.label, v));
  return out;
}

function mapTeamRow(row: typeof team.$inferSelect): TeamRow {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    mcpEnabled: row.mcpEnabled,
    projectsEnabled: row.projectsEnabled,
    dashboardsEnabled: row.dashboardsEnabled,
    notesEnabled: row.notesEnabled,
    createdAt: iso(row.createdAt),
  };
}

// Reads a whole object from the store into a Buffer, for copying a skill's reference
// files into the new team's own object prefix.
async function readObjectBytes(key: string): Promise<{ bytes: Buffer; contentType: string }> {
  const { body, contentType } = await getObject(key);
  const bytes = Buffer.from(await new Response(body).arrayBuffer());
  return { bytes, contentType };
}

// Creates a new team that copies the selected parts of the source team's
// configuration, but none of its issues. The creator becomes the new team's owner.
//
// Pure-database entities (states, types, labels, custom fields, views, dashboards,
// actions, roles, settings, webhooks, integration credentials, configured tools) are
// copied in one transaction, recording old id → new id so the ids that views/actions
// and tools/agents reference are remapped to the copied entities. Entities with side
// effects outside the database are copied after that transaction commits: skills copy
// their object-store files, agents create their own bot user and API key, and both go
// through the same store functions the UI uses.
export async function copyTeam(
  sourceTeamId: string,
  input: { key: string; name: string; description?: string },
  ownerId: string,
  rawInclude?: Partial<CopyTeamInclude>,
): Promise<TeamRow> {
  const inc = normalizeInclude(rawInclude);

  const maps: CopyIdMaps = {
    column: new Map(),
    labelGroup: new Map(),
    label: new Map(),
    type: new Map(),
    field: new Map(),
    option: new Map(),
  };
  const roleMap = new Map<string, string>();
  const integrationMap = new Map<string, string>();
  const toolMap = new Map<string, string>();
  const skillMap = new Map<string, string>();
  const agentMap = new Map<string, string>();

  const newTeam = await db.transaction(async (tx) => {
    // The optional sections the source team shows are part of its configuration,
    // so the copy starts with the same ones. mcpEnabled is not carried: a copy opts
    // into MCP on its own.
    const [sourceFeatures] = await tx
      .select({
        projectsEnabled: team.projectsEnabled,
        dashboardsEnabled: team.dashboardsEnabled,
        notesEnabled: team.notesEnabled,
      })
      .from(team)
      .where(eq(team.id, sourceTeamId));

    const [row] = await tx
      .insert(team)
      .values({
        key: input.key.toUpperCase(),
        name: input.name,
        description: input.description ?? '',
        ...sourceFeatures,
      })
      .returning();
    const proj = mapTeamRow(row);
    await tx.insert(teamMember).values({ teamId: proj.id, userId: ownerId, role: 'owner' });

    // Roles. When copied, every source role is carried over (including which one is
    // the default), so agents/members keep their role assignments. Otherwise the
    // team starts with just the standard default "Member" role, as a fresh team
    // does.
    if (inc.roles) {
      const roleRows = await tx.select().from(teamRole).where(eq(teamRole.teamId, sourceTeamId));
      for (const r of roleRows) {
        const [created] = await tx
          .insert(teamRole)
          .values({
            teamId: proj.id,
            name: r.name,
            isDefault: r.isDefault,
            permissions: r.permissions,
          })
          .returning({ id: teamRole.id });
        roleMap.set(r.id, created.id);
      }
      const hasDefault = roleRows.some((r) => r.isDefault);
      if (!hasDefault) {
        await tx.insert(teamRole).values({
          teamId: proj.id,
          name: 'Member',
          isDefault: true,
          permissions: defaultMemberPermissions(),
        });
      }
    } else {
      await tx.insert(teamRole).values({
        teamId: proj.id,
        name: 'Member',
        isDefault: true,
        permissions: defaultMemberPermissions(),
      });
    }

    // States (columns). When copied, every source column is carried over so views,
    // actions and issues have somewhere to map to. When not copied, the team is
    // seeded with the default columns instead, so it is still usable (a team with
    // no state has nowhere to put an issue).
    if (inc.states) {
      const columnRows = await tx
        .select()
        .from(workflowState)
        .where(eq(workflowState.teamId, sourceTeamId))
        .orderBy(workflowState.position);
      for (const col of columnRows) {
        const [created] = await tx
          .insert(workflowState)
          .values({
            teamId: proj.id,
            name: col.name,
            stateType: col.stateType,
            color: col.color,
            position: col.position,
          })
          .returning({ id: workflowState.id });
        maps.column.set(col.id, created.id);
      }
    } else {
      for (const [position, column] of DEFAULT_COLUMNS.entries()) {
        await tx.insert(workflowState).values({
          teamId: proj.id,
          name: column.name,
          stateType: column.stateType,
          color: column.color,
          position,
        });
      }
    }

    if (inc.issueTypes) {
      const typeRows = await tx
        .select()
        .from(issueType)
        .where(eq(issueType.teamId, sourceTeamId))
        .orderBy(issueType.position);
      for (const t of typeRows) {
        const [created] = await tx
          .insert(issueType)
          .values({
            teamId: proj.id,
            name: t.name,
            icon: t.icon,
            color: t.color,
            isDefault: t.isDefault,
            position: t.position,
          })
          .returning({ id: issueType.id });
        maps.type.set(t.id, created.id);
      }
    }

    if (inc.labels) {
      // Label groups are copied before labels so each copied label's group_id can be
      // remapped to the new group.
      const labelGroupRows = await tx
        .select()
        .from(labelGroup)
        .where(eq(labelGroup.teamId, sourceTeamId));
      for (const g of labelGroupRows) {
        const [created] = await tx
          .insert(labelGroup)
          .values({ teamId: proj.id, name: g.name, color: g.color })
          .returning({ id: labelGroup.id });
        maps.labelGroup.set(g.id, created.id);
      }

      const labelRows = await tx.select().from(label).where(eq(label.teamId, sourceTeamId));
      for (const l of labelRows) {
        const [created] = await tx
          .insert(label)
          .values({
            teamId: proj.id,
            groupId: l.groupId != null ? (maps.labelGroup.get(l.groupId) ?? null) : null,
            name: l.name,
            color: l.color,
          })
          .returning({ id: label.id });
        maps.label.set(l.id, created.id);
      }
    }

    // Type-scoped custom fields (with their options). Team-wide fields
    // (issue_type_id NULL) are not copied.
    if (inc.customFields && maps.type.size > 0) {
      const fieldRows = await tx
        .select()
        .from(customField)
        .where(inArray(customField.issueTypeId, Array.from(maps.type.keys())))
        .orderBy(customField.position);
      for (const f of fieldRows) {
        const [created] = await tx
          .insert(customField)
          .values({
            teamId: proj.id,
            issueTypeId: f.issueTypeId != null ? (maps.type.get(f.issueTypeId) ?? null) : null,
            name: f.name,
            fieldType: f.fieldType,
            position: f.position,
          })
          .returning({ id: customField.id });
        maps.field.set(f.id, created.id);

        const optionRows = await tx
          .select()
          .from(customFieldOption)
          .where(eq(customFieldOption.fieldId, f.id))
          .orderBy(customFieldOption.position);
        for (const o of optionRows) {
          const [newOption] = await tx
            .insert(customFieldOption)
            .values({ fieldId: created.id, value: o.value, color: o.color, position: o.position })
            .returning({ id: customFieldOption.id });
          maps.option.set(o.id, newOption.id);
        }
      }
    }

    // Views: their filters reference the ids captured above.
    if (inc.views) {
      const viewRows = await tx
        .select()
        .from(teamView)
        .where(eq(teamView.teamId, sourceTeamId))
        .orderBy(teamView.position, teamView.id);
      for (const v of viewRows) {
        await tx.insert(teamView).values({
          teamId: proj.id,
          name: v.name,
          icon: v.icon,
          filters: remapViewFilters(v.filters, maps) ?? {},
          display: remapViewDisplay(v.display, maps) ?? {},
          position: v.position,
        });
      }
    }

    // Dashboards: the layout blob is copied verbatim. Widget filters that reference
    // assignee/type/label ids are not remapped (those filters just match nothing until
    // re-set); the metric widgets, which are team-scoped and id-agnostic, work
    // unchanged.
    if (inc.dashboards) {
      const dashboardRows = await tx
        .select()
        .from(teamDashboard)
        .where(eq(teamDashboard.teamId, sourceTeamId))
        .orderBy(teamDashboard.position, teamDashboard.id);
      for (const d of dashboardRows) {
        await tx.insert(teamDashboard).values({
          teamId: proj.id,
          name: d.name,
          icon: d.icon,
          layout: d.layout ?? [],
          position: d.position,
        });
      }
    }

    // Actions: their condition (a FilterSet) and effect (a partial patch) hold ids
    // captured above, so they are remapped to the copied entities.
    if (inc.actions) {
      const actionRows = await tx
        .select()
        .from(teamAction)
        .where(eq(teamAction.teamId, sourceTeamId))
        .orderBy(teamAction.position, teamAction.id);
      for (const a of actionRows) {
        await tx.insert(teamAction).values({
          teamId: proj.id,
          name: a.name,
          icon: a.icon,
          condition: remapViewFilters(a.condition, maps) ?? {},
          effect: remapActionEffect(a.effect, maps) ?? {},
          position: a.position,
        });
      }
    }

    // Team settings key/value rows (the Archive section's auto-archive thresholds,
    // and any other team-scoped setting). Copied verbatim.
    if (inc.archive) {
      const settingRows = await tx
        .select()
        .from(teamSetting)
        .where(eq(teamSetting.teamId, sourceTeamId));
      for (const s of settingRows) {
        await tx.insert(teamSetting).values({ teamId: proj.id, key: s.key, value: s.value });
      }
    }

    // Notification provider credentials: the single per-team row, copied verbatim
    // (its config is already encrypted at rest). Per-member event/channel preferences
    // are personal and not copied.
    if (inc.notificationProviders) {
      const [ns] = await tx
        .select()
        .from(teamNotificationSetting)
        .where(eq(teamNotificationSetting.teamId, sourceTeamId));
      if (ns) {
        await tx.insert(teamNotificationSetting).values({
          teamId: proj.id,
          ciphertext: ns.ciphertext,
          iv: ns.iv,
          authTag: ns.authTag,
          redacted: ns.redacted,
        });
      }
    }

    // Webhook subscriptions, copied verbatim including the signing secret so an
    // existing receiver keeps verifying. The failure counter resets.
    if (inc.webhooks) {
      const webhookRows = await tx
        .select()
        .from(webhook)
        .where(eq(webhook.teamId, sourceTeamId))
        .orderBy(webhook.id);
      for (const w of webhookRows) {
        await tx.insert(webhook).values({
          teamId: proj.id,
          url: w.url,
          secret: w.secret,
          events: w.events,
          isActive: w.isActive,
        });
      }
    }

    // Integration credentials (LLM and tool secrets), copied verbatim — the ciphertext
    // is already encrypted and the team scope is the boundary. Their ids are mapped
    // so configured tools and agents' model credentials point at the copies.
    if (inc.integrations) {
      const credRows = await tx
        .select()
        .from(integrationCredential)
        .where(eq(integrationCredential.teamId, sourceTeamId))
        .orderBy(integrationCredential.id);
      for (const c of credRows) {
        const [created] = await tx
          .insert(integrationCredential)
          .values({
            teamId: proj.id,
            integrationKey: c.integrationKey,
            label: c.label,
            ciphertext: c.ciphertext,
            iv: c.iv,
            authTag: c.authTag,
            redacted: c.redacted,
          })
          .returning({ id: integrationCredential.id });
        integrationMap.set(c.id, created.id);
      }
    }

    // Configured tools: each binds a tool key to one integration credential, remapped
    // to the copied credential. A tool whose credential was not copied is skipped.
    if (inc.tools) {
      const toolRows = await tx
        .select()
        .from(agentTool)
        .where(eq(agentTool.teamId, sourceTeamId))
        .orderBy(agentTool.id);
      for (const tRow of toolRows) {
        const newCredId = integrationMap.get(tRow.credentialId);
        if (newCredId == null) continue;
        const [created] = await tx
          .insert(agentTool)
          .values({ teamId: proj.id, toolKey: tRow.toolKey, credentialId: newCredId })
          .returning({ id: agentTool.id });
        toolMap.set(tRow.id, created.id);
      }
    }

    return proj;
  });

  // Skills: copy each skill's object-store files into the new team's own prefix,
  // then create the row through the same store the UI uses.
  if (inc.skills) {
    for (const s of await listSkills(sourceTeamId)) {
      const markdown = await getSkillMarkdown(s.id, sourceTeamId);
      const refs = [];
      for (const f of s.files) {
        const { bytes, contentType } = await readObjectBytes(f.s3Key);
        refs.push({ path: f.path, bytes, contentType });
      }
      const created = await createSkillFromFiles(newTeam.id, {
        name: s.name,
        description: s.description,
        source: s.source,
        sourceUrl: s.sourceUrl,
        markdown,
        refs,
      });
      skillMap.set(s.id, created.id);
    }
  }

  // Agents: each gets its own bot user and API key through createAgent, with its model
  // credential and role remapped to the copies. An external agent's key is regenerated
  // and cannot be recovered here — its operator resets it in the new team. Skill and
  // tool links are re-created only for the skills/tools that were also copied.
  if (inc.agents) {
    for (const a of await listAgents(sourceTeamId)) {
      const agentInput: NewAgentInput = {
        name: a.name,
        username: a.username,
        kind: a.kind,
        modelCredentialId:
          a.modelCredentialId != null ? (integrationMap.get(a.modelCredentialId) ?? null) : null,
        model: a.model,
        instructions: a.instructions,
        tools: a.tools,
        temperature: a.temperature,
        maxSteps: a.maxSteps,
        memoryEnabled: a.memoryEnabled,
        memoryLastMessages: a.memoryLastMessages,
        triggerOnMention: a.triggerOnMention,
        triggerOnAssign: a.triggerOnAssign,
        roleId: a.roleId != null ? (roleMap.get(a.roleId) ?? null) : null,
      };
      const { agent } = await createAgent(newTeam.id, agentInput);
      agentMap.set(a.id, agent.id);

      if (inc.skills) {
        const skillIds = (await listAgentSkills(a.id))
          .map((s) => skillMap.get(s.id))
          .filter((id): id is string => id != null);
        if (skillIds.length > 0) await setAgentSkills(agent.id, newTeam.id, skillIds);
      }
      if (inc.tools) {
        const toolIds = (await listAgentToolLinks(a.id))
          .map((tRow) => toolMap.get(tRow.id))
          .filter((id): id is string => id != null);
        if (toolIds.length > 0) await setAgentTools(agent.id, newTeam.id, toolIds);
      }
    }
  }

  // Schedules: re-created for the copied agents. next_run_at is recomputed from the
  // cron so the copy starts on its own cadence rather than inheriting a past due time.
  if (inc.schedules) {
    for (const s of await listAgentSchedules(sourceTeamId)) {
      const newAgentId = agentMap.get(s.agentId);
      if (newAgentId == null) continue;
      await createAgentSchedule({
        teamId: newTeam.id,
        agentId: newAgentId,
        name: s.name,
        prompt: s.prompt,
        cron: s.cron,
        status: s.status,
        nextRunAt: nextCronRun(s.cron),
      });
    }
  }

  return newTeam;
}
