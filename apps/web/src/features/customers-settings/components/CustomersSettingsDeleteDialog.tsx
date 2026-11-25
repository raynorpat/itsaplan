'use client';

import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import {
  type CustomerListItem,
  type CustomerListKind,
  useCustomerListWrites,
} from '@/services/customers.service';

// Confirms deleting a status (its customers move to the first status) or a tier (its
// customers lose their tier).
export default function CustomersSettingsDeleteDialog({
  kind,
  item,
  onClose,
}: {
  kind: CustomerListKind;
  item: CustomerListItem;
  onClose: () => void;
}) {
  const { remove } = useCustomerListWrites(kind);
  return (
    <ConfirmDialog
      title={`Delete ${kind} “${item.displayName}”?`}
      confirmLabel="Delete"
      onConfirm={async () => {
        await remove.mutateAsync(item.id);
        onClose();
      }}
      onClose={onClose}
    >
      <p className="text-sm text-muted-foreground">
        {kind === 'status'
          ? 'Customers with this status move to the first status.'
          : 'Customers in this tier will have no tier.'}
      </p>
    </ConfirmDialog>
  );
}
