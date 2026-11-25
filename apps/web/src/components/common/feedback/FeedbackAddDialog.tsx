'use client';

import { useState } from 'react';
import Avatar from '@/components/common/Avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useAddFeedback } from '@/services/feedback.service';
import type { FeedbackRequester } from '@/utils/feedback';
import CustomerChip from './CustomerChip';
import FeedbackNewRequesterForm from './FeedbackNewRequesterForm';
import FeedbackRequesterPicker from './FeedbackRequesterPicker';

// Adds feedback to an issue: pick or create the person (their customer shows next to
// them; the feedback belongs to it), paste what they said, mark it important.
export default function FeedbackAddDialog({
  issueId,
  onClose,
}: {
  issueId: string;
  onClose: () => void;
}) {
  const [requester, setRequester] = useState<FeedbackRequester | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [important, setImportant] = useState(false);
  const add = useAddFeedback(issueId);

  function submit() {
    if (!requester || add.isPending) return;
    add.mutate({ requesterId: requester.id, body, important }, { onSuccess: onClose });
  }

  let step;
  if (requester) {
    step = (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 self-start">
          <button
            type="button"
            className="flex items-center gap-2 rounded text-sm hover:underline"
            onClick={() => setRequester(null)}
          >
            <Avatar name={requester.name} image={requester.avatarUrl} />
            {requester.name}
            <span className="text-xs text-muted-foreground">Change</span>
          </button>
          <CustomerChip customer={requester.customer ?? null} />
        </div>
        <Textarea
          autoFocus
          aria-label="What did they say?"
          placeholder="What did they say?"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit()}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={important} onCheckedChange={(v) => setImportant(v === true)} />
          Important
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={add.isPending} onClick={submit}>
            Add feedback
          </Button>
        </div>
      </div>
    );
  } else if (newName !== null) {
    step = (
      <FeedbackNewRequesterForm
        initialName={newName}
        onCreated={(r) => {
          setNewName(null);
          setRequester(r);
        }}
        onBack={() => setNewName(null)}
      />
    );
  } else {
    step = <FeedbackRequesterPicker onPick={setRequester} onNew={setNewName} />;
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Add feedback</DialogTitle>
        {step}
      </DialogContent>
    </Dialog>
  );
}
