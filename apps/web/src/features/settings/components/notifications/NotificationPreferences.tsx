import { type ReactNode } from 'react';
import { Mail } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import SettingsSection from '@/components/common/page/SettingsSection';
import { NOTIFICATION_CATEGORIES } from '../../utils/notificationEvents';
import type { NotificationPreferencesForm } from '../../hooks/useNotificationPreferencesForm';

// The user's own email notification preferences for the whole workspace: for each
// notification category, whether it is sent by email. Email is sent to the account
// address through the instance email provider. Save lives in the page header.

// Shared column template so the header label lines up with every event row.
const COLS = 'grid grid-cols-[1fr_5rem] items-center';

export default function NotificationPreferences({ form }: { form: NotificationPreferencesForm }) {
  const { emailCategories, setEmailCategories } = form;
  return (
    <div className="flex flex-col gap-10">
      <SettingsSection title="Categories">
        <div className="max-w-xl">
          <div className={`${COLS} px-3 pb-1`}>
            <span />
            <ChannelHeader icon={<Mail className="size-3.5" />} label="Email" />
          </div>
          <div className="flex flex-col">
            {NOTIFICATION_CATEGORIES.map((category) => (
              <ChannelRow
                key={category.key}
                label={category.label}
                emailChecked={emailCategories[category.key]}
                onEmail={(v) => setEmailCategories({ ...emailCategories, [category.key]: v })}
              />
            ))}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

function ChannelHeader({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}

function ChannelRow({
  label,
  emailChecked,
  onEmail,
}: {
  label: string;
  emailChecked: boolean;
  onEmail: (value: boolean) => void;
}) {
  return (
    <div className={`${COLS} -mx-3 rounded-md px-3 py-2.5 transition-colors hover:bg-accent`}>
      <span className="text-sm">{label}</span>
      <div className="flex justify-center">
        <Checkbox
          checked={emailChecked}
          onCheckedChange={(v) => onEmail(v === true)}
          aria-label={`${label} — email`}
        />
      </div>
    </div>
  );
}
