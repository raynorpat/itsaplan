import { WEBHOOK_RESOURCE_TYPES, type WebhookResourceType } from '@/lib/api';
import { Checkbox } from '@/components/ui/checkbox';

// Checkboxes for the Linear resource types a webhook receives.
export function SettingsWebhookResourceTypes({
  value,
  onChange,
}: {
  value: Set<WebhookResourceType>;
  onChange: (next: Set<WebhookResourceType>) => void;
}) {
  function toggle(type: WebhookResourceType, on: boolean) {
    const next = new Set(value);
    if (on) next.add(type);
    else next.delete(type);
    onChange(next);
  }

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">Resource types</span>
      <div className="grid gap-2 sm:grid-cols-2">
        {WEBHOOK_RESOURCE_TYPES.map((type) => (
          <label key={type.value} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={value.has(type.value)}
              onCheckedChange={(v) => toggle(type.value, v === true)}
            />
            <span>{type.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
