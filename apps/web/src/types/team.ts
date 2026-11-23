import type { WorkspaceRole } from '@/types/workspace';
import type { Issue } from '@/types/issue';
import type { FilterSet } from '@/utils/filters';
import type { SavedViewDisplay } from '@/utils/viewSettings';

export interface Team {
  id: string;
  key: string;
  name: string;
  description: string;
  // Linear's team visibility: a public team is open to every owner, admin and
  // member of the workspace; a private one to its members only.
  visibility: TeamVisibility;
  createdAt: string;
  // The caller's membership in this team, only on the /teams list: 'owner' (a
  // team owner), 'member', or null for a public team they have not joined.
  role?: MemberRole | null;
  // Whether the caller manages the team (team owner, workspace admin or owner, or
  // any member of a team without owners). Only on the /teams list.
  canManage?: boolean;
}

export type TeamVisibility = 'public' | 'private';

export type StateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

export interface Column {
  id: string;
  teamId: string;
  name: string;
  stateType: StateType;
  color: string;
  description: string;
  position: number;
  archivedAt: string | null;
}

export interface Label {
  id: string;
  // Null for a workspace label (shared by every team; managed over the API).
  teamId: string | null;
  // The group this label belongs to, or null when ungrouped.
  groupId: string | null;
  name: string;
  color: string;
  // Set when the label is retired: it stays on issues but is not offered.
  retiredAt: string | null;
}

// A container a label can belong to. Labels reference it by groupId.
export interface LabelGroup {
  id: string;
  teamId: string | null;
  name: string;
  color: string;
}

export interface Assignee {
  userId: string;
  name: string;
  email: string;
  image: string | null;
}

// A saved view (a tab above the work items view): a named filter set plus a display
// snapshot (layout + that layout's settings). The API stores the filter as Linear's
// IssueFilter (`filterData`) and the display as the view's organization view
// preferences; the client converts the filter to and from the filter bar's set.
export interface View {
  id: string;
  teamId: string;
  name: string;
  icon: string | null;
  filters: FilterSet;
  display: SavedViewDisplay;
  createdAt: string;
}

// The caller's access to a team, returned with it: their membership (null for a
// public team they have not joined), their workspace role, and whether they
// manage the team. See usePermissions.
export interface TeamViewer {
  role: MemberRole | null;
  workspaceRole: WorkspaceRole;
  canManage: boolean;
}

// Linear's team cycle settings (Team.cyclesEnabled, cycleDuration, …). Duration and
// cooldown are in weeks; startDay is 0 (Sunday) to 6 (Saturday), in UTC.
export interface TeamCycleSettings {
  enabled: boolean;
  duration: number;
  startDay: number;
  cooldown: number;
  upcomingCount: number;
  autoAssignStarted: boolean;
  autoAssignCompleted: boolean;
}

// A team cycle (Linear's Cycle) as the board's pickers, groups and badges use it.
// name is null for an unnamed cycle (shown as "Cycle N").
export interface Cycle {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
}

// The board scaffold, returned by getTeam: everything the work-items UI needs
// except the issues themselves (those come from getBoardIssues).
export interface TeamScaffold {
  team: Team;
  cycles: TeamCycleSettings;
  // The team's current and upcoming cycles, for the cycle pickers. Past cycles come
  // with their issues (Issue.cycle).
  teamCycles: Cycle[];
  states: Column[];
  labels: Label[];
  labelGroups: LabelGroup[];
  assignees: Assignee[];
  viewer: TeamViewer;
}

// The board's issues, returned by getBoardIssues and refetched on an interval.
export interface BoardIssues {
  issues: Issue[];
}

// The scaffold composed with its issues, as the Shell assembles it and passes it
// down. Downstream reads team.issues off this composite.
export type TeamDetail = TeamScaffold & BoardIssues;

// Team membership: 'owner' marks a team owner, who manages the team's settings
// with the workspace admins.
export type MemberRole = 'owner' | 'member';

export interface MemberRow {
  // The TeamMembership id, which removing the member addresses.
  membershipId: string;
  teamId: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: MemberRole;
  createdAt: string;
}
