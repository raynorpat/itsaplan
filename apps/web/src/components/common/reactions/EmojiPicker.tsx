'use client';

import { useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// A small emoji picker for reactions: a fixed set of common emoji with a name
// search. Picking one calls onPick and closes the picker.

const EMOJI: { emoji: string; name: string }[] = [
  { emoji: '👍', name: 'thumbs up yes' },
  { emoji: '👎', name: 'thumbs down no' },
  { emoji: '❤️', name: 'heart love' },
  { emoji: '🎉', name: 'party tada celebrate' },
  { emoji: '😄', name: 'smile happy laugh' },
  { emoji: '😕', name: 'confused unsure' },
  { emoji: '🚀', name: 'rocket ship launch' },
  { emoji: '👀', name: 'eyes looking' },
  { emoji: '✅', name: 'check done' },
  { emoji: '🔥', name: 'fire hot' },
  { emoji: '🙏', name: 'thanks pray' },
  { emoji: '💯', name: 'hundred perfect' },
  { emoji: '🤔', name: 'thinking hmm' },
  { emoji: '😢', name: 'sad cry' },
  { emoji: '⚠️', name: 'warning caution' },
  { emoji: '🐛', name: 'bug' },
];

export default function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? EMOJI.filter((e) => e.name.includes(q)) : EMOJI;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label="Add reaction"
        >
          <SmilePlus className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji"
          className="mb-2 h-8"
        />
        <div className="grid grid-cols-8 gap-0.5">
          {shown.map((e) => (
            <button
              key={e.emoji}
              type="button"
              title={e.name.split(' ')[0]}
              className="flex size-6 items-center justify-center rounded hover:bg-accent"
              onClick={() => {
                onPick(e.emoji);
                setOpen(false);
                setQuery('');
              }}
            >
              {e.emoji}
            </button>
          ))}
        </div>
        {shown.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground">No emoji match.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
