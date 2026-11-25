'use client';

import { Switch } from '@/components/ui/switch';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import { type CustomersSettings, useSaveCustomersSettings } from '@/services/customers.service';
import CustomersSettingsCurrencySelect from './CustomersSettingsCurrencySelect';

// The Customers switch and the currency revenue is recorded in.
export default function CustomersSettingsGeneral({
  settings,
  canEdit,
}: {
  settings: CustomersSettings;
  canEdit: boolean;
}) {
  const save = useSaveCustomersSettings();
  const disabled = !canEdit || save.isPending;

  return (
    <SettingsCard className="divide-y divide-border/60">
      <SettingsRow
        title="Customers"
        description="Match people to customers by email domain, count requests by customer, and give a customer its own portal board."
        note={canEdit ? undefined : 'Only workspace owners and admins can change this.'}
        control={
          <Switch
            checked={settings.enabled}
            disabled={disabled}
            onCheckedChange={(enabled) => save.mutate({ enabled })}
          />
        }
      />
      {settings.enabled && (
        <SettingsRow
          title="Revenue currency"
          description="The currency of each customer's annual revenue."
          control={
            <CustomersSettingsCurrencySelect
              value={settings.revenueCurrency}
              disabled={disabled}
              onChange={(revenueCurrency) => save.mutate({ revenueCurrency })}
            />
          }
        />
      )}
    </SettingsCard>
  );
}
