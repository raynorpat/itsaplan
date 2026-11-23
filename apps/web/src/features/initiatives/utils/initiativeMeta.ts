// Linear's initiative statuses with their labels and colors. The pickers offer the
// three Linear's app uses (Planned, Active, Completed); the other two are shown
// when an initiative has them (set through the API).
export type InitiativeStatus = 'Proposed' | 'Planned' | 'Active' | 'Completed' | 'Canceled';

export const INITIATIVE_STATUS_META: Record<InitiativeStatus, { label: string; color: string }> = {
  Proposed: { label: 'Proposed', color: '#a1a1aa' },
  Planned: { label: 'Planned', color: '#71717a' },
  Active: { label: 'Active', color: '#eab308' },
  Completed: { label: 'Completed', color: '#6366f1' },
  Canceled: { label: 'Canceled', color: '#ef4444' },
};

export const OFFERED_STATUSES: InitiativeStatus[] = ['Planned', 'Active', 'Completed'];
