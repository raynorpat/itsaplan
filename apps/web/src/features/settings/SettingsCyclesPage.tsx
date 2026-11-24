'use client';

import { useShell } from '@/context/shellContext';
import SettingsCyclesView from './components/cycles/SettingsCyclesView';

// The Cycles settings page (/settings/teams/:teamKey/cycles).
export default function SettingsCyclesPage() {
  const { team } = useShell();
  if (!team) return null;
  return <SettingsCyclesView team={team} />;
}
