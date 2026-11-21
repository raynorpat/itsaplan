import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import type { GeneralForm } from '../../hooks/useGeneralForm';

// The Team block of the General page. The key is shown read-only: it prefixes
// every issue and cannot change. Only an owner may edit; others see the values
// read-only.
export default function SettingsGeneral({ form }: { form: GeneralForm }) {
  return (
    <SettingsSection title="Team" description="The key prefixes every issue and cannot change.">
      <SettingsCard className="space-y-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="team-key">Key</Label>
          <Input id="team-key" value={form.key} disabled readOnly />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="team-name">Name</Label>
          <Input
            id="team-name"
            value={form.name}
            onChange={(e) => form.setName(e.target.value)}
            disabled={!form.editable}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="team-description">Description</Label>
          <Textarea
            id="team-description"
            rows={3}
            value={form.description}
            onChange={(e) => form.setDescription(e.target.value)}
            disabled={!form.editable}
          />
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
