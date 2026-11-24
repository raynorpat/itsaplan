'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { useUpdateAccountPreferences } from '@/services/preferences.service';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

// The workspace menu's theme switch. The choice is saved to the account, as in
// preferences, so it reaches other devices. The label waits for mount because the
// resolved theme is unknown during server rendering.
export default function WorkspaceMenuTheme() {
  const { resolvedTheme, setTheme } = useTheme();
  const update = useUpdateAccountPreferences();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <DropdownMenuItem
      onSelect={() => {
        const next = isDark ? 'light' : 'dark';
        setTheme(next);
        update.mutate({ theme: next });
      }}
    >
      {isDark ? <Sun /> : <Moon />}
      {isDark ? 'Light theme' : 'Dark theme'}
    </DropdownMenuItem>
  );
}
