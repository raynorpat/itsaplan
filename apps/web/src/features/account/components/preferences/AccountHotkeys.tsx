import type { HotkeyOverrides } from '@/types/account';
import { DEFAULT_COMBOS } from '@/utils/hotkeys';
import HotkeysEditor from '@/components/common/hotkeys/HotkeysEditor';

// The user's own shortcut overrides on top of the built-in bindings; resetting a row
// falls back to the built-in key. Each change saves immediately, like the rest of the
// preferences page.
export default function AccountHotkeys({
  overrides,
  onChange,
}: {
  overrides: HotkeyOverrides;
  onChange: (overrides: HotkeyOverrides) => void;
}) {
  return <HotkeysEditor base={DEFAULT_COMBOS} overrides={overrides} onChange={onChange} />;
}
