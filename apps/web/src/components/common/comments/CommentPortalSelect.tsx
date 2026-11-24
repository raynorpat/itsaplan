import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// The value for a comment that stays inside the workspace.
export const INTERNAL = 'internal';

// Where a new comment goes: internal, or a portal board (visitors there see it).
export default function CommentPortalSelect({
  boards,
  value,
  onChange,
}: {
  boards: { id: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label="Where the comment goes" className="text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INTERNAL}>Internal</SelectItem>
        {boards.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            Post on portal: {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
