import { useEffect, useRef, useState, type DragEvent } from 'react';
import { type Editor } from '@tiptap/react';
import type { TeamDetail } from '@/types/team';
import { type NewIssueDefaults } from '@/utils/team';
import { useSession } from '@/lib/auth-client';
import { useCreateIssue, useUpdateIssue } from '@/services/issues.service';
import { useUploadAttachment } from '../../services/attachments.service';
import { attachmentHtml } from '@/utils/attachmentEmbed';
import Modal from '@/components/common/overlay/Modal';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import AssigneeSelect from '@/components/common/fields/AssigneeSelect';
import DatePill from '@/components/common/fields/DatePill';
import LabelsSelect from '@/components/common/fields/LabelsSelect';
import PrioritySelect from '@/components/common/fields/PrioritySelect';
import StatusSelect from '@/components/common/fields/StatusSelect';
import CycleSelect from '@/components/common/fields/CycleSelect';
import { cyclesVisible } from '@/utils/cycles';
import { Button } from '@/components/ui/button';
import ProjectSelect from '../fields/ProjectSelect';

export default function NewIssueModal({
  team,
  defaults,
  onClose,
  onCreated,
}: {
  team: TeamDetail;
  defaults: NewIssueDefaults;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stateId, setColumnId] = useState(defaults.stateId);
  const [projectId, setProjectId] = useState<string | null>(defaults.projectId ?? null);
  // Preset when the issue is created from a cycle's page or a cycle group.
  const [cycleId, setCycleId] = useState<string | null>(defaults.cycleId ?? null);
  const showCycle = cyclesVisible(team);
  const { data: session } = useSession();
  // Assignee defaults to the creating user unless the caller set one explicitly
  // (defaults.assigneeUserId is null for the "No assignee" board group).
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(() => {
    if (defaults.assigneeUserId !== undefined) return defaults.assigneeUserId;
    const userId = session?.user.id;
    return userId != null && team.assignees.some((a) => a.userId === userId) ? userId : null;
  });
  const [priority, setPriority] = useState(defaults.priority ?? 0);
  const [dueDate, setDueDate] = useState('');
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const createIssue = useCreateIssue();
  const updateIssue = useUpdateIssue(team.team.key);
  const uploadAttachment = useUploadAttachment();

  // Files pasted or dropped into the description before the issue exists.
  // Attachments upload against an issue id, which we only have after creation,
  // so each file is shown inline via a local blob: URL and held here; on submit
  // they are uploaded for real and their blob: URLs rewritten to the stored URL.
  const pendingFilesRef = useRef(new Map<string, File>());
  const uploadFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    pendingFilesRef.current.set(url, file);
    return { url, contentType: file.type, filename: file.name };
  };

  // Revoke any object URLs still pending when the modal unmounts (closed without
  // submitting); the submit path revokes the ones it consumes.
  useEffect(() => {
    const pending = pendingFilesRef.current;
    return () => {
      for (const url of pending.keys()) URL.revokeObjectURL(url);
    };
  }, []);

  // The description editor instance, so a file dropped anywhere on the modal
  // (not just onto the small editor box) can be inserted at the cursor.
  const [descEditor, setDescEditor] = useState<Editor | null>(null);

  const dropFilesIntoDescription = (files: FileList) => {
    if (!descEditor) return;
    let pos = descEditor.state.selection.to;
    void (async () => {
      for (const file of Array.from(files)) {
        const a = await uploadFile(file).catch(() => null);
        if (!a || !descEditor) continue;
        descEditor.chain().insertContentAt(pos, attachmentHtml(a)).focus().run();
        pos = descEditor.state.selection.to;
      }
    })();
  };

  function onModalDragOver(e: DragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  }

  function onModalDrop(e: DragEvent<HTMLDivElement>) {
    // A drop landing on the editor box is already handled by tiptap, which
    // calls preventDefault; only handle drops elsewhere on the modal here.
    if (e.defaultPrevented) return;
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    e.preventDefault();
    dropFilesIntoDescription(files);
  }

  function toggleLabel(id: string) {
    setLabelIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const created = await createIssue.mutateAsync({
        teamKey: team.team.key,
        input: {
          title: title.trim(),
          description: description.trim() || undefined,
          stateId,
          projectId,
          // Left out when unset, so the team's auto-add rules still apply.
          cycleId: showCycle && cycleId ? cycleId : undefined,
          assigneeUserId,
          priority: priority,
          dueDate: dueDate || null,
          labelIds,
        },
      });
      // Upload files pasted/dropped into the description, then rewrite their
      // blob: URLs to the stored attachment URLs. A failed upload drops its
      // placeholder rather than leaving a dead blob: link.
      const pending = pendingFilesRef.current;
      if (pending.size > 0) {
        let body = description;
        for (const [blobUrl, file] of pending) {
          const a = await uploadAttachment
            .mutateAsync({ issueId: created.id, file })
            .catch(() => null);
          body = body.replaceAll(blobUrl, a ? a.url : '');
          URL.revokeObjectURL(blobUrl);
        }
        pending.clear();
        if (body !== description) {
          await updateIssue.mutateAsync({ id: created.id, patch: { description: body.trim() } });
        }
      }

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New issue" teamKey={team.team.key} onClose={onClose} wide>
      <div onDragOver={onModalDragOver} onDrop={onModalDrop}>
        <input
          className="w-full bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground"
          placeholder="Issue title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <MarkdownEditor
          className="mt-3 min-h-24"
          defaultValue={description}
          onChange={setDescription}
          onReady={setDescEditor}
          uploadFile={uploadFile}
        />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusSelect columns={team.states} value={stateId} onChange={setColumnId} />

          {team.assignees.length > 0 && (
            <AssigneeSelect
              assignees={team.assignees}
              value={assigneeUserId}
              onChange={setAssigneeUserId}
              placeholder="Assignee"
            />
          )}

          <PrioritySelect value={priority} onChange={setPriority} />

          <ProjectSelect teamKey={team.team.key} value={projectId} onChange={setProjectId} />

          {showCycle && (
            <CycleSelect cycles={team.teamCycles} value={cycleId} onChange={setCycleId} />
          )}

          {team.labels.length > 0 && (
            <LabelsSelect
              labels={team.labels}
              groups={team.labelGroups}
              value={labelIds}
              onToggle={toggleLabel}
            />
          )}

          <DatePill
            value={dueDate || null}
            placeholder="Due date"
            onChange={(v) => setDueDate(v ?? '')}
          />
        </div>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        <div className="mt-4 flex items-center justify-end border-t pt-3">
          <Button disabled={saving || !title.trim()} onClick={submit}>
            Create issue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
