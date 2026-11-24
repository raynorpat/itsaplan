import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BoardForm } from '../utils/board';
import PortalBoardField from './PortalBoardField';
import PortalBoardSwitch from './PortalBoardSwitch';

// Name, address, intro text, and what visitors see of an issue.
export default function PortalBoardGeneralFields({
  form,
  errors,
  set,
}: {
  form: BoardForm;
  errors: Record<string, string>;
  set: (patch: Partial<BoardForm>) => void;
}) {
  return (
    <div className="grid gap-4">
      <PortalBoardField id="board-name" label="Name" error={errors.name}>
        <Input id="board-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </PortalBoardField>
      <PortalBoardField
        id="board-slug"
        label="Address"
        hint={`/portal/${form.slug || 'address'}`}
        error={errors.slug}
      >
        <Input
          id="board-slug"
          value={form.slug}
          onChange={(e) => set({ slug: e.target.value.toLowerCase() })}
        />
      </PortalBoardField>
      <PortalBoardField id="board-intro" label="Intro" hint="Shown at the top of the board.">
        <Textarea
          id="board-intro"
          rows={3}
          value={form.intro}
          onChange={(e) => set({ intro: e.target.value })}
        />
      </PortalBoardField>
      <PortalBoardField id="board-comments" label="Comments visitors see">
        <Select
          value={form.comments}
          onValueChange={(v) => set({ comments: v as BoardForm['comments'] })}
        >
          <SelectTrigger id="board-comments" className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="portal">Portal threads only</SelectItem>
            <SelectItem value="all">All comments</SelectItem>
          </SelectContent>
        </Select>
      </PortalBoardField>
      <PortalBoardSwitch
        id="board-description"
        label="Show issue descriptions"
        checked={form.showDescription}
        onChange={(showDescription) => set({ showDescription })}
      />
      <PortalBoardSwitch
        id="board-enabled"
        label="Board is active"
        checked={form.enabled}
        onChange={(enabled) => set({ enabled })}
      />
    </div>
  );
}
