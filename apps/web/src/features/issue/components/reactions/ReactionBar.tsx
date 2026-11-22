'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { groupReactions, type ReactionNode } from '@/utils/reactions';
import EmojiPicker from './EmojiPicker';

// The reactions on an issue or a comment: one chip per emoji with its count and,
// on hover, who reacted. Clicking a chip adds or removes the viewer's own reaction
// with that emoji; the picker adds a new one.

export default function ReactionBar({
  reactions,
  viewerId,
  onToggle,
  className,
}: {
  reactions: ReactionNode[];
  viewerId: string | null;
  onToggle: (emoji: string, mineId: string | null) => void;
  className?: string;
}) {
  const groups = groupReactions(reactions, viewerId);

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {groups.map((g) => (
        <Tooltip key={g.emoji}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-pressed={g.mineId != null}
              onClick={() => onToggle(g.emoji, g.mineId)}
              className={cn(
                'flex h-6 items-center gap-1 rounded-full border px-2 text-xs',
                g.mineId
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <span>{g.emoji}</span>
              <span>{g.count}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{g.users.length ? g.users.join(', ') : 'Removed user'}</TooltipContent>
        </Tooltip>
      ))}
      {viewerId && (
        <EmojiPicker
          onPick={(emoji) => onToggle(emoji, groups.find((g) => g.emoji === emoji)?.mineId ?? null)}
        />
      )}
    </div>
  );
}
