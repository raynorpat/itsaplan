import { db, label, workflowState } from '@repo/db';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { activeRequester, createNeed, createRequesterAttachment } from '../feedback/store';
import { createIssue } from '../issues/store';
import { HttpError } from '../shared/lib';
import { defaultColumnId } from '../states/store';
import { getTeamById } from '../teams/store';
import {
  chosenOptions,
  formIssueDescription,
  roleAnswer,
  type Answers,
  type FormRow,
} from './settings';

// A confirmed form submission: an issue in the form's team, credited to the requester
// (Linear's externalUserCreator, no member creator), plus their feedback from the form.
// It is a normal issue creation: webhooks and workflow rules run as for any new issue.
// Labels, state and priority the form names but that no longer apply (a deleted label,
// an archived state) are left out, so a submission never fails on them.

const MAX_TITLE = 255;

export interface FormOrigin {
  // The portal board the form was submitted on, and that board's project.
  boardId: string | null;
  projectId: string | null;
}

// The ids among `ids` that can be newly applied in the team: its own or workspace
// labels, not groups, not retired.
async function applicableLabelIds(teamId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: label.id })
    .from(label)
    .where(
      and(
        inArray(label.id, ids),
        or(eq(label.teamId, teamId), isNull(label.teamId)),
        eq(label.isGroup, false),
        isNull(label.retiredAt),
      ),
    );
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => found.has(id));
}

async function stateFor(teamId: string, stateId: string | undefined): Promise<string> {
  if (stateId) {
    const [row] = await db
      .select({ id: workflowState.id })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.id, stateId),
          eq(workflowState.teamId, teamId),
          isNull(workflowState.archivedAt),
        ),
      );
    if (row) return row.id;
  }
  const fallback = await defaultColumnId(teamId);
  if (!fallback) throw new HttpError(400, 'The team has no backlog or unstarted state');
  return fallback;
}

// The form's team and the state its issues get, or an HttpError when the form cannot
// take an issue now (its team gone or private, no state to put the issue in). The
// link's confirmation checks this before it uses the token.
export async function formDestination(form: FormRow) {
  const teamId = form.template.teamId;
  const team = teamId ? await getTeamById(teamId) : null;
  if (!team || team.visibility !== 'public') throw new HttpError(404, 'Form not found');
  return { team, stateId: await stateFor(team.id, form.data.stateId) };
}

export async function submitForm(
  form: FormRow,
  answers: Answers,
  requesterId: string,
  origin: FormOrigin,
): Promise<{ issueId: string; identifier: string }> {
  const { team, stateId } = await formDestination(form);
  const requester = await activeRequester(requesterId);
  if (!requester) throw new HttpError(404, 'Requester not found');

  const options = chosenOptions(form, answers);
  const labelIds = await applicableLabelIds(team.id, [
    ...new Set([
      ...(form.data.labelIds ?? []),
      ...options.flatMap((o) => (o.labelId ? [o.labelId] : [])),
    ]),
  ]);
  // The last chosen option that sets a priority wins.
  const optionPriority = options.filter((o) => o.priority !== undefined).at(-1)?.priority;
  const title =
    roleAnswer(form, answers, 'title')?.slice(0, MAX_TITLE) ??
    `${form.template.name} from ${requester.name}`.slice(0, MAX_TITLE);

  const created = await createIssue(
    team,
    {
      stateId,
      title,
      description: formIssueDescription(form, answers),
      labelIds,
      priority: optionPriority ?? form.data.priority ?? 0,
      projectId: origin.projectId,
      externalUserCreatorId: requester.id,
      portalSourceBoardId: origin.boardId,
    },
    null,
  );
  const { attachmentId } = await createRequesterAttachment(
    created.id,
    requester.id,
    'form',
    null,
    form.template.name,
  );
  await createNeed({
    issueId: created.id,
    attachmentId,
    body: roleAnswer(form, answers, 'quote') ?? null,
    creatorId: null,
  });
  return { issueId: created.id, identifier: created.identifier };
}
