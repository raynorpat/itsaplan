import { type TeamDetail, type IssueDetail as IssueDetailRow } from '@/lib/api';
import { useIssueDetail } from '../../hooks/useIssueDetail';
import IssueAttachmentsPanel from './IssueAttachmentsPanel';
import IssueActivityFeed from './IssueActivityFeed';
import IssueStatusTimeline from './IssueStatusTimeline';
import IssueMarkdownEditor from '../editor/IssueMarkdownEditor';
import IssueProperties from './IssueProperties';
import IssueActionsBar from '../actions/IssueActionsBar';

// The full editable body of a issue — title, description, attachments, the Properties grid, and the activity feed. Shared by the
// side panel (IssueDetail) and the full-page view (IssueViewPage); each supplies
// its own surrounding chrome (close button / breadcrumbs). Data loading and
// mutations live in useIssueDetail; this component is layout only.
export default function IssueDetailContent({
  team,
  issueId,
  onIssueLoaded,
  onDeleted,
  layout = 'panel',
}: {
  team: TeamDetail;
  issueId: string;
  onIssueLoaded?: (issue: IssueDetailRow) => void;
  // Called after the issue is deleted, so the surrounding chrome can leave the
  // now-gone issue (close the panel / return to the team).
  onDeleted?: () => void;
  // 'panel' stacks everything in one column (side panel). 'page' puts the
  // Properties in a right sidebar fixed to the viewport edge (Linear full-page
  // layout). 'split' is the same two-column shape but in normal flow (no fixed
  // positioning), so it fits inside a narrower container like the inbox pane.
  layout?: 'panel' | 'page' | 'split';
}) {
  const {
    issue,
    patch,
    toggleLabel,
    insertAttachment,
    uploadFile,
    imageAttachments,
    setDescEditor,
  } = useIssueDetail(team, issueId, onIssueLoaded);

  if (!issue) {
    return <div className="py-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const isPage = layout === 'page';
  // Both the full page and the split view show Properties in a right sidebar.
  const hasSidebar = layout !== 'panel';

  const body = (
    <>
      <div className="flex items-center gap-2">
        {issue.archivedAt && (
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
            Archived
          </span>
        )}
        <input
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground"
          placeholder="Issue title"
          defaultValue={issue.title}
          key={`title-${issue.updatedAt}`}
          onBlur={(e) => {
            if (e.target.value.trim() && e.target.value !== issue.title)
              patch({ title: e.target.value.trim() });
          }}
        />
      </div>

      <IssueMarkdownEditor
        className="mt-2"
        defaultValue={issue.description}
        key={`desc-${issue.updatedAt}`}
        onReady={setDescEditor}
        uploadFile={uploadFile}
        imageAttachments={imageAttachments}
        onBlur={(md) => {
          if (md !== issue.description) patch({ description: md });
        }}
      />

      <IssueAttachmentsPanel issueId={issue.id} onInsert={insertAttachment} />
    </>
  );

  const properties = (
    <IssueProperties
      team={team}
      issue={issue}
      onPatch={patch}
      onToggleLabel={toggleLabel}
      hasSidebar={hasSidebar}
    />
  );

  const actions = (
    <IssueActionsBar team={team} issue={issue} hasSidebar={hasSidebar} onDeleted={onDeleted} />
  );

  // A feed entry stores the author's name, not their picture, so the uploaded avatar
  // comes from the team's candidate list by actor id. An author who is no longer a
  // member falls back to the initials circle.
  const imageByUserId = new Map(team.assignees.map((a) => [a.userId, a.image]));

  const activity = (
    <>
      <IssueStatusTimeline issueId={issue.id} columns={team.states} imageByUserId={imageByUserId} />
      <IssueActivityFeed
        issueId={issue.id}
        assignees={team.assignees}
        imageByUserId={imageByUserId}
      />
    </>
  );

  if (isPage) {
    // The issue content is left-aligned; the Properties panel is fixed to the
    // right edge (out of flow), so it never shifts the content.
    return (
      <>
        <div className="max-w-3xl">
          {body}
          {activity}
        </div>
        <aside className="fixed top-16 right-6 max-h-[calc(100vh-5.5rem)] w-[340px] overflow-y-auto">
          {actions}
          {properties}
        </aside>
      </>
    );
  }

  if (layout === 'split') {
    // Two columns in normal flow: content on the left, Properties as a right
    // sidebar. Unlike 'page' the sidebar is not viewport-fixed, so it stays inside
    // a narrower host (the inbox detail pane) without overlapping the content.
    return (
      <div className="flex gap-8">
        <div className="min-w-0 flex-1">
          {body}
          {activity}
        </div>
        <aside className="w-[320px] shrink-0">
          {actions}
          {properties}
        </aside>
      </div>
    );
  }

  // The panel renders the actions in its header row (see IssueDetail), so the
  // panel body omits them; the page keeps them in the sticky sidebar above.
  return (
    <>
      {body}
      {properties}
      {activity}
    </>
  );
}
