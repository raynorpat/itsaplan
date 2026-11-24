import { useMemo } from 'react';
import { type WorkItemsViewProps } from '@/utils/team';
import { SelectionProvider } from '@/context/useSelection';
import { BulkActionBar } from '@/components/common/board/kanban/BulkActionBar';
import { ListBody } from './ListBody';

// Linear's List layout: one dense line per issue under group headers. It shares
// the board's multi-select and bulk-action bar. `validIds` are the issues on the
// list, so a selected issue that leaves it drops from the selection.
export default function ListView(props: WorkItemsViewProps) {
  const validIds = useMemo(() => new Set(props.team.issues.map((i) => i.id)), [props.team.issues]);
  return (
    <SelectionProvider validIds={validIds}>
      <ListBody {...props} />
      {!props.readOnly && <BulkActionBar team={props.team} />}
    </SelectionProvider>
  );
}
