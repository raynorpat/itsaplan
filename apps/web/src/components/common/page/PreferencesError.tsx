import { Button } from '@/components/ui/button';
import { EmptyState } from './EmptyState';

// Shown in place of a list whose stored display did not load. The list stays hidden
// so a display change cannot replace the stored record with the defaults.
export function PreferencesError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState title="The display settings did not load" description={message}>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </EmptyState>
  );
}
