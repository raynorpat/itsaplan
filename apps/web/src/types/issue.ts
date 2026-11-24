import type { Cycle } from '@/types/team';

export interface ProjectOption {
  id: string;
  title: string;
  // In the trash, or archived through the API; the issue keeps the link.
  deleted: boolean;
}

export interface Issue {
  id: string;
  teamId: string;
  // Team-scoped sequence number (the "42" in "MKT-42"). Addresses the issue by
  // its human number in URLs (/team/MKT/issue/42).
  sequenceNumber: number;
  identifier: string;
  // The project this issue is linked to, expanded to id + title for rendering,
  // or null. Set through updateIssue by projectId.
  project: ProjectOption | null;
  assigneeUserId: string | null;
  delegateUserId: string | null;
  stateId: string;
  // Parent issue id (sub-issues), or null for a top-level issue.
  parentId: string | null;
  projectMilestoneId: string | null;
  // The team cycle the issue belongs to. cycleId is what edits change; cycle is the
  // cycle as the server last returned it, so a past cycle that is not in
  // TeamScaffold.teamCycles still has a name (see knownCycles).
  cycleId: string | null;
  cycle?: Cycle | null;
  creatorUserId: string | null;
  title: string;
  description: string;
  // Linear's scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
  priority: number;
  estimate: number | null;
  dueDate: string | null;
  position: number;
  // Status timestamps, kept in step with the column type by the API.
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  // When the issue was archived (hidden from the board but kept), or null when it
  // is active. Set by the archive action or the worker's auto-archive sweep.
  archivedAt: string | null;
  labelIds: string[];
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  // Absolute, no-auth URL — usable directly in <img>/<video> and in markdown.
  url: string;
}

// `action` selects how the UI renders an activity row; from_text/to_text are
// display-ready value snapshots (column/label/assignee name, raw priority, ISO
// date, or the new text of a long field). `subject` names the changed sub-item
// where the action alone is not enough (the relation type for 'relation').
export type ActivityAction =
  | 'created'
  | 'title'
  | 'description'
  | 'status'
  | 'assignee'
  | 'delegate'
  | 'priority'
  | 'due_date'
  | 'parent'
  | 'label_add'
  | 'label_remove'
  | 'archived'
  | 'restored'
  | 'relation'
  | 'project'
  | 'cycle';

// One entry in an issue's timeline. kind selects which payload fields are set:
// a 'comment' carries body; an 'activity' carries action/subject/fromText/toText.
// actorName is the author/actor snapshot (null when it was never set).
export interface FeedItem {
  id: string;
  issueId: string;
  kind: 'comment' | 'activity';
  actorUserId: string | null;
  actorName: string | null;
  // The actor is an app user (an OAuth application installed with actor=app).
  actorIsApp?: boolean;
  // The actor is a workflow (Linear's ActorBot of type "workflow"); actorName is its name.
  actorWorkflow?: boolean;
  body: string | null;
  action: ActivityAction | null;
  subject: string | null;
  fromText: string | null;
  toText: string | null;
  // Comments only: the thread root of a reply, and when the comment was last edited.
  parentId: string | null;
  editedAt: string | null;
  createdAt: string;
  // Comments only: the agent session whose thread this root comment starts.
  agentSessionId?: string | null;
  // Comments only: their reactions.
  reactions?: { id: string; emoji: string; user: { id: string; name: string } | null }[];
}

export type IssueDetail = Issue;

export interface NewIssueInput {
  // Creates the issue as a sub-issue of this one.
  parentId?: string;
  projectId?: string | null;
  cycleId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  stateId: string;
  title: string;
  description?: string;
  priority?: number;
  dueDate?: string | null;
  labelIds?: string[];
}

// The fields a bulk update can set on many issues at once (the board-relevant
// subset of IssuePatch: no title/description/position).
export interface BulkIssuePatch {
  stateId?: string;
  projectId?: string | null;
  cycleId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  priority?: number;
  dueDate?: string | null;
}

export interface IssuePatch {
  stateId?: string;
  // The parent issue (sub-issues); null makes the issue top-level.
  parentId?: string | null;
  position?: number;
  projectId?: string | null;
  cycleId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  title?: string;
  description?: string;
  priority?: number;
  dueDate?: string | null;
  labelIds?: string[];
}
