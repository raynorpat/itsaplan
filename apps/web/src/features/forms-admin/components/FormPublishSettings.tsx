import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useFormBoardOptions, useProjectTeams } from '../services/formsAdmin.service';
import { eligibleBoards, formUrl, type FormEditorState } from '../utils/formEditor';
import FormSettingField from './FormSettingField';

// Where the form is shown: its address and intro, the public link switch, and the
// portal boards of its team (or of projects including it) that show it instead of
// their Suggest box.
export default function FormPublishSettings({
  form,
  errors,
  set,
}: {
  form: FormEditorState;
  errors: Record<string, string>;
  set: (patch: Partial<FormEditorState>) => void;
}) {
  const boards = useFormBoardOptions(true).data ?? [];
  const projectTeams = useProjectTeams(true).data ?? {};
  const eligible = eligibleBoards(boards, form.teamId, projectTeams);
  const toggleBoard = (id: string, on: boolean) =>
    set({ boardIds: on ? [...form.boardIds, id] : form.boardIds.filter((b) => b !== id) });

  return (
    <div className="grid gap-4">
      <FormSettingField
        id="form-slug"
        label="Address"
        hint={`/forms/${form.slug || 'address'}`}
        error={errors.slug}
      >
        <Input
          id="form-slug"
          value={form.slug}
          onChange={(e) => set({ slug: e.target.value.toLowerCase() })}
        />
      </FormSettingField>
      <FormSettingField id="form-intro" label="Intro" hint="Shown above the questions.">
        <Textarea
          id="form-intro"
          rows={3}
          value={form.intro}
          onChange={(e) => set({ intro: e.target.value })}
        />
      </FormSettingField>
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <Switch
            id="form-link"
            checked={form.linkEnabled}
            onCheckedChange={(linkEnabled) => set({ linkEnabled })}
          />
          <Label htmlFor="form-link">Share with a link</Label>
          {form.linkEnabled && !errors.slug && form.slug && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                void navigator.clipboard
                  .writeText(formUrl(form.slug))
                  .then(() => toast.success('Link copied'))
              }
            >
              Copy link
            </Button>
          )}
        </div>
        {form.linkEnabled && (
          <p className="text-xs text-muted-foreground">
            Anyone with the link can submit. Requests are created once the person confirms their
            email address.
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <div className="text-sm font-medium">Portal boards</div>
        {!form.teamId && (
          <p className="text-xs text-muted-foreground">Choose a team to see its boards.</p>
        )}
        {form.teamId && eligible.length === 0 && (
          <p className="text-xs text-muted-foreground">No portal board shows this team.</p>
        )}
        {eligible.map((b) => {
          const id = `form-board-${b.id}`;
          return (
            <div key={b.id} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={form.boardIds.includes(b.id)}
                onCheckedChange={(v) => toggleBoard(b.id, v === true)}
              />
              <Label htmlFor={id}>{b.name}</Label>
            </div>
          );
        })}
        {eligible.length > 0 && (
          <p className="text-xs text-muted-foreground">
            A board with forms shows them instead of its Suggest box. Visitors sign in to submit.
          </p>
        )}
      </div>
    </div>
  );
}
