import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { FormDto } from '../services/formsAdmin.service';
import { formUrl } from '../utils/formEditor';

// One form in the list: name, team, address and where it is shown, with Copy link
// and Edit.
export default function FormRow({ form, onEdit }: { form: FormDto; onEdit: () => void }) {
  const url = formUrl(form.slug);
  const boards = form.boardIds.length;
  const facts = [
    form.teamName,
    form.linkEnabled ? 'Link on' : 'Link off',
    ...(boards > 0 ? [boards === 1 ? 'On 1 board' : `On ${boards} boards`] : []),
  ];
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{form.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          /forms/{form.slug} · {facts.join(' · ')}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {form.linkEnabled && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void navigator.clipboard.writeText(url).then(() => toast.success('Link copied'))
            }
          >
            Copy link
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}
