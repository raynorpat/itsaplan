import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FIELD_TYPES,
  moveField,
  newField,
  setRole,
  type FormField,
  type FormRole,
} from '../utils/formEditor';
import FormFieldEditor from './FormFieldEditor';

// The form's questions in order. Every form also asks for the person's email and
// name when they are not signed in to the portal; those are not questions here.
export default function FormQuestions({
  fields,
  errors,
  onChange,
  teamId,
}: {
  fields: FormField[];
  errors: Record<string, string>;
  onChange: (fields: FormField[]) => void;
  teamId: string;
}) {
  const replace = (next: FormField) => onChange(fields.map((f) => (f.id === next.id ? next : f)));

  return (
    <div className="grid gap-3">
      <div>
        <div className="text-sm font-medium">Questions</div>
        <p className="text-xs text-muted-foreground">
          The answers fill the issue description. The person’s email and name are asked for when
          they are not signed in to the portal.
        </p>
      </div>
      {fields.map((f, i) => (
        <FormFieldEditor
          key={f.id}
          field={f}
          error={errors[`field:${f.id}`]}
          teamId={teamId}
          onChange={replace}
          onRole={(role: FormRole | null) => onChange(setRole(fields, f.id, role))}
          onMove={(delta) => onChange(moveField(fields, i, i + delta))}
          onRemove={() => onChange(fields.filter((x) => x.id !== f.id))}
          first={i === 0}
          last={i === fields.length - 1}
        />
      ))}
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Plus /> Add question
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {FIELD_TYPES.map((t) => (
              <DropdownMenuItem
                key={t.type}
                onSelect={() => onChange([...fields, newField(t.type)])}
              >
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
