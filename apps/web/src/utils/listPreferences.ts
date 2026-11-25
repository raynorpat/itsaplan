// The list kinds whose display is one personal record per user on the server
// (Linear's view types). A setting applies to every list of its kind: every team's
// All issues, every project's issues, every cycle, My issues, and the projects list.
export type ListViewType = 'allIssues' | 'project' | 'cycle' | 'myIssues' | 'projects';

// Where a list's stored display stands. A change is saved only once the stored
// display has loaded: before that, or after a failed load, the list holds the
// defaults, and saving them would replace the user's record.
export function preferencesState(query: { isSuccess: boolean; isError: boolean }): {
  status: 'loading' | 'ready' | 'error';
  canSave: boolean;
} {
  if (query.isSuccess) return { status: 'ready', canSave: true };
  return { status: query.isError ? 'error' : 'loading', canSave: false };
}

export interface PreferenceSync<T> {
  // Replaces the pending value and restarts the wait.
  push: (value: T) => void;
  // Sends the pending value now (the list is left, or the page is hidden: then with
  // keepalive, so the request outlives the page).
  flush: (keepalive?: boolean) => void;
  // Drops the pending value (signing out).
  cancel: () => void;
}

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

// Saves the latest value of a setting: quick successive changes go out as one save
// after `delayMs` without a further change, and one save is in flight at a time,
// so an older value never lands after a newer one. onSaved's `latest` is true when
// nothing newer is waiting; onFailed's `newer` is true when a newer value will
// still be sent, so the caller keeps showing it.
export function createPreferenceSync<T>({
  save,
  delayMs,
  onSaved,
  onFailed,
  timers = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
}: {
  save: (value: T, keepalive: boolean) => Promise<void>;
  delayMs: number;
  onSaved: (value: T, latest: boolean) => void;
  onFailed: (error: unknown, value: T, newer: boolean) => void;
  timers?: Timers;
}): PreferenceSync<T> {
  let pending: { value: T } | null = null;
  let handle: unknown = null;
  let inFlight = false;
  // A flush arrived while a save was in flight: send the pending value after it.
  let flushAfter = false;

  const clearTimer = () => {
    if (handle != null) timers.clear(handle);
    handle = null;
  };

  const send = (keepalive: boolean) => {
    if (!pending) return;
    const { value } = pending;
    pending = null;
    inFlight = true;
    const next = () => {
      inFlight = false;
      if (flushAfter && handle == null) {
        flushAfter = false;
        send(false);
      }
    };
    save(value, keepalive).then(
      () => {
        onSaved(value, pending == null);
        next();
      },
      (error: unknown) => {
        onFailed(error, value, pending != null);
        next();
      },
    );
  };

  const flush = (keepalive = false) => {
    clearTimer();
    if (!pending) return;
    if (inFlight) {
      flushAfter = true;
      return;
    }
    send(keepalive);
  };

  return {
    push(value) {
      pending = { value };
      clearTimer();
      handle = timers.set(() => {
        handle = null;
        flush();
      }, delayMs);
    },
    flush,
    cancel() {
      clearTimer();
      pending = null;
      flushAfter = false;
    },
  };
}
