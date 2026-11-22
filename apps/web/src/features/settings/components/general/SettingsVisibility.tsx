import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import SettingsRow from '@/components/common/page/SettingsRow';
import { Switch } from '@/components/ui/switch';
import type { VisibilityToggleForm } from '../../hooks/useVisibilityToggle';

// The Visibility block of the General page: a private team is visible to its
// members only; a public one to every owner, admin and member of the workspace.
// Only a team manager may change it.
export default function SettingsVisibility({ form }: { form: VisibilityToggleForm }) {
  return (
    <SettingsSection
      title="Visibility"
      description="Who can find and work in this team. Guests only ever see teams they were added to."
    >
      <SettingsCard>
        <SettingsRow
          title="Private team"
          description="Only members see the team and its issues. Admins can still see that it exists."
          control={
            <Switch
              checked={form.visibility === 'private'}
              disabled={!form.editable || form.saving}
              onCheckedChange={(on) => void form.change(on ? 'private' : 'public')}
            />
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}
