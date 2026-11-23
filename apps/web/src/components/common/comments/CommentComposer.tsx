import { useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'lucide-react';
import type { Assignee } from '@/types/team';
import Avatar from '@/components/common/Avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCreateComment, useUpdateComment } from '@/services/comments.service';
import { type CommentTarget } from '@/utils/commentTarget';

// The comment box: a plain markdown textarea with an @-mention menu. It posts a new
// comment, a reply (`parentId`), or saves an edit (`editing`); a reply or an edit
// calls `onDone` once saved or cancelled. Typing "@"
// opens a menu of the team's members; picking one inserts a mention token
// @[Name](user:<id>) into the body. The token is what the backend parses to notify
// the member (see the feed's chip rendering for how it displays). Posts as the current session user on the button or Cmd/Ctrl+Enter.

// The active "@query" being typed: the text after the "@" and the body index of the
// "@" itself, so a pick can replace the whole "@query" span.
interface MentionQuery {
  query: string;
  anchor: number;
}

export default function CommentComposer({
  target,
  assignees,
  authorName,
  authorImage,
  parentId,
  editing,
  onDone,
}: {
  target: CommentTarget;
  assignees: Assignee[];
  authorName: string;
  authorImage?: string | null;
  parentId?: string;
  editing?: { id: string; body: string };
  onDone?: () => void;
}) {
  const createComment = useCreateComment();
  const updateComment = useUpdateComment();
  const [body, setBody] = useState(editing?.body ?? '');
  const [menu, setMenu] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const posting = createComment.isPending || updateComment.isPending;
  const submitLabel = editing ? 'Save' : parentId ? 'Reply' : 'Comment';
  const cmdKey = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';

  const matches = useMemo(() => {
    if (!menu) return [];
    const q = menu.query.toLowerCase();
    return assignees.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 8);
  }, [assignees, menu]);

  // Restore the caret after a mention is inserted (the body change is async, so the
  // caret has to be set once the new value has rendered).
  useEffect(() => {
    if (pendingCaret == null) return;
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(pendingCaret, pendingCaret);
    }
    setPendingCaret(null);
  }, [pendingCaret]);

  // Opens the mention menu when the text right before the caret is an "@query"
  // (an @ at a word boundary followed by non-space, non-@ characters).
  function onChange(value: string, caret: number) {
    setBody(value);
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (m) {
      setMenu({ query: m[1], anchor: caret - m[1].length - 1 });
      setActive(0);
    } else {
      setMenu(null);
    }
  }

  function selectMention(a: Assignee) {
    if (!menu) return;
    const token = `@[${a.name}](user:${a.userId})`;
    const caret = taRef.current?.selectionStart ?? body.length;
    const next = `${body.slice(0, menu.anchor)}${token} ${body.slice(caret)}`;
    setBody(next);
    setMenu(null);
    setPendingCaret(menu.anchor + token.length + 1);
  }

  // Set synchronously, so a second Cmd/Ctrl+Enter before the pending state renders
  // does not post twice.
  const inFlight = useRef(false);

  async function post() {
    if (!body.trim() || inFlight.current) return;
    inFlight.current = true;
    try {
      if (editing) await updateComment.mutateAsync({ target, id: editing.id, body: body.trim() });
      else await createComment.mutateAsync({ target, input: { body: body.trim(), parentId } });
    } finally {
      inFlight.current = false;
    }
    setBody('');
    setMenu(null);
    onDone?.();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menu && matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMention(matches[Math.min(active, matches.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }
    // Cmd/Ctrl+Enter submits, matching the rest of the planner; Escape cancels a
    // reply or an edit.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void post();
    if (e.key === 'Escape' && onDone) onDone();
  }

  return (
    <div className={onDone ? 'mt-2' : 'mb-5'}>
      <div className="flex gap-3">
        <Avatar
          name={authorName}
          image={authorImage}
          className="mt-0.5 size-7 text-[11px]"
          title={`Comment as ${authorName}`}
        />
        <div className="relative min-w-0 flex-1">
          <div className="overflow-hidden rounded-lg border bg-muted/20 shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
            <Textarea
              ref={taRef}
              value={body}
              onChange={(e) =>
                onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
              }
              onBlur={() => setMenu(null)}
              autoFocus={!!onDone}
              placeholder={
                parentId
                  ? 'Write a reply…'
                  : editing
                    ? 'Edit comment'
                    : 'Write a comment… use @ to mention'
              }
              className="min-h-[64px] resize-none rounded-none border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:ring-0"
              onKeyDown={onKeyDown}
            />
            <div className="flex items-center justify-between gap-2 border-t px-2.5 py-2">
              <span className="text-[11px] text-muted-foreground/70">
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium">
                  {cmdKey} ↵
                </kbd>
                <span className="ml-1.5">to send</span>
              </span>
              <div className="flex items-center gap-1.5">
                {onDone && (
                  <Button size="sm" variant="ghost" onClick={onDone}>
                    Cancel
                  </Button>
                )}
                <Button size="sm" disabled={!body.trim() || posting} onClick={() => void post()}>
                  {posting ? 'Saving…' : submitLabel}
                </Button>
              </div>
            </div>
          </div>

          {menu && matches.length > 0 && (
            <ul className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
              {matches.map((a, i) => (
                <li key={a.userId}>
                  <button
                    type="button"
                    // Keep the textarea focused so the caret survives the click.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectMention(a);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
                      i === active ? 'bg-accent text-accent-foreground' : ''
                    }`}
                  >
                    <User className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{a.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
