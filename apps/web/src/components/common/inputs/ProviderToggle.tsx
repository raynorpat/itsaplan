import { cn } from '@/lib/utils';

export type EmailProvider = 'smtp' | 'resend';

const OPTIONS: EmailProvider[] = ['smtp', 'resend'];

const LABELS: Record<EmailProvider, string> = {
  smtp: 'SMTP',
  resend: 'Resend',
};

// A segmented control choosing which email provider is configured. Only one email
// provider is active at a time, so this picks both the visible form and the channel
// that sends. Styled from the muted/background tokens, not a bordered box.
export default function ProviderToggle({
  value,
  onChange,
  disabled,
}: {
  value: EmailProvider;
  onChange: (value: EmailProvider) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-[3px]" role="tablist">
      {OPTIONS.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(option)}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-medium transition-colors',
              'focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
