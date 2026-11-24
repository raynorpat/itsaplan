// The app's keyboard shortcuts, in one place. Every binding that runs a command
// is declared here; the listeners (the global layer, the board selection) ask this
// module whether an event matches an id instead of comparing keys themselves, so a
// combination is defined once and can be overridden per instance and per user.
//
// Not listed: Escape to close a surface and the Enter/arrow handling inside inputs,
// menus and dialogs. Those are conventions of the control they belong to, not
// commands, and they are never rebound.

export type HotkeyId =
  | 'palette.toggle'
  | 'team.switch'
  | 'sidebar.toggle'
  | 'view.kanban'
  | 'view.list'
  | 'view.timeline'
  | 'view.calendar'
  | 'issue.new'
  | 'team.new'
  | 'team.settings'
  | 'settings.open'
  | 'board.select-all'
  | 'list.next'
  | 'list.prev'
  | 'list.select'
  | 'list.open';

// `scope` decides when the binding is live. A 'global' one fires even while the
// user types or an overlay is open; an 'app' one is suppressed then, because its
// combination is a plain key that would land in the text being typed.
// `fixed` marks a binding that cannot be rebound: it is positional (⌘1–9) rather
// than a single combination.
export type HotkeyDef = {
  id: HotkeyId;
  label: string;
  group: string;
  combo: string;
  scope: 'global' | 'app';
  fixed?: true;
};

// A combo is written as lowercase tokens joined by '+': the modifiers 'mod'
// (⌘ on macOS, Ctrl elsewhere), 'shift' and 'alt', then the key. The key 'digit'
// stands for the digits 1–9 and is only used by the positional team switch.
export const HOTKEYS: HotkeyDef[] = [
  {
    id: 'palette.toggle',
    label: 'Open the command palette',
    group: 'General',
    combo: 'mod+k',
    scope: 'global',
  },
  {
    id: 'team.switch',
    label: 'Switch to team 1–9',
    group: 'General',
    combo: 'mod+digit',
    scope: 'global',
    fixed: true,
  },
  // Bound by the sidebar primitive (components/ui/sidebar), which carries its own
  // listener. Listed here so the shortcut is documented in one place; it is not
  // rebindable for that reason.
  {
    id: 'sidebar.toggle',
    label: 'Show or hide the sidebar',
    group: 'General',
    combo: 'mod+b',
    scope: 'global',
    fixed: true,
  },
  { id: 'issue.new', label: 'New issue', group: 'General', combo: 'n', scope: 'app' },
  { id: 'team.new', label: 'New team', group: 'General', combo: 'b', scope: 'app' },
  {
    id: 'team.settings',
    label: 'Open team settings',
    group: 'General',
    combo: 's',
    scope: 'app',
  },
  {
    id: 'settings.open',
    label: 'Open settings',
    group: 'General',
    combo: 'mod+,',
    scope: 'global',
  },
  { id: 'view.kanban', label: 'Board layout', group: 'Issues', combo: '1', scope: 'app' },
  { id: 'view.list', label: 'List layout', group: 'Issues', combo: '2', scope: 'app' },
  { id: 'view.timeline', label: 'Timeline layout', group: 'Issues', combo: '3', scope: 'app' },
  { id: 'view.calendar', label: 'Calendar layout', group: 'Issues', combo: '4', scope: 'app' },
  {
    id: 'board.select-all',
    label: 'Select all issues on the board',
    group: 'Issues',
    combo: 'mod+a',
    scope: 'app',
  },
  { id: 'list.next', label: 'Focus the next issue', group: 'List', combo: 'j', scope: 'app' },
  {
    id: 'list.prev',
    label: 'Focus the previous issue',
    group: 'List',
    combo: 'k',
    scope: 'app',
  },
  {
    id: 'list.select',
    label: 'Select the focused issue',
    group: 'List',
    combo: 'x',
    scope: 'app',
  },
  // Enter is not a letter or a digit, so it cannot be recorded as a new binding.
  {
    id: 'list.open',
    label: 'Open the focused issue',
    group: 'List',
    combo: 'enter',
    scope: 'app',
    fixed: true,
  },
];

export type HotkeyCombos = Record<HotkeyId, string>;

export const DEFAULT_COMBOS = Object.fromEntries(
  HOTKEYS.map((h) => [h.id, h.combo]),
) as HotkeyCombos;

// Lays a set of overrides over a resolved map. Ids the app does not know are
// ignored, so a stale override left by a removed command cannot shadow a current
// binding.
export function applyOverrides(
  base: HotkeyCombos,
  overrides: Record<string, string>,
): HotkeyCombos {
  const next = { ...base };
  for (const [id, combo] of Object.entries(overrides)) {
    if (id in next) next[id as HotkeyId] = combo;
  }
  return next;
}

type ParsedCombo = { mod: boolean; shift: boolean; alt: boolean; key: string };

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split('+');
  return {
    mod: parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    key: parts[parts.length - 1] ?? '',
  };
}

// ⌘ and Ctrl are treated as the same modifier, so a combination works on macOS and
// on Windows/Linux without a per-platform table.
export type KeyEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

function matchesParsed(e: KeyEventLike, c: ParsedCombo): boolean {
  const mod = e.metaKey || e.ctrlKey;
  return mod === c.mod && e.shiftKey === c.shift && e.altKey === c.alt;
}

export function matchesCombo(e: KeyEventLike, combo: string): boolean {
  const c = parseCombo(combo);
  return matchesParsed(e, c) && e.key.toLowerCase() === c.key;
}

// The digit 1–9 a positional combination was pressed with, or null. Used by the
// team switch, which has no fixed key.
export function matchedDigit(e: KeyEventLike, combo: string): number | null {
  const c = parseCombo(combo);
  if (c.key !== 'digit' || !matchesParsed(e, c)) return null;
  return /^[1-9]$/.test(e.key) ? Number(e.key) : null;
}

// The combination a key press stands for, or null when the press cannot be bound:
// a modifier on its own, or a key that is not a letter or a digit. Used by the
// settings screens to record a new binding.
export function comboFromEvent(e: KeyEventLike): string | null {
  const key = e.key.toLowerCase();
  if (!/^[a-z0-9]$/.test(key)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(key);
  return parts.join('+');
}

// True when the event target is a text field, where a plain-key shortcut would
// swallow the character being typed.
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName ?? ''))
  );
}

// The roles of the layers a plain-key shortcut must not reach past: a dialog's or a
// menu's keys belong to it (Radix dialogs, dropdown menus and select lists all carry
// one of these roles).
const LAYER_ROLES = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]';

// True when a plain-key app shortcut must not fire for this target: while typing, or
// with focus inside a dialog, menu or list.
export function blocksShortcuts(target: EventTarget | null): boolean {
  if (isTypingTarget(target)) return true;
  const el = target as Element | null;
  return typeof el?.closest === 'function' && el.closest(LAYER_ROLES) != null;
}

// The combination as shown in the UI: ⌘K on macOS, Ctrl+K elsewhere.
export function formatCombo(combo: string, isMac: boolean): string {
  const c = parseCombo(combo);
  const out: string[] = [];
  if (c.mod) out.push(isMac ? '⌘' : 'Ctrl');
  if (c.shift) out.push(isMac ? '⇧' : 'Shift');
  if (c.alt) out.push(isMac ? '⌥' : 'Alt');
  out.push(c.key === 'digit' ? '1–9' : c.key.toUpperCase());
  return isMac ? out.join('') : out.join('+');
}
