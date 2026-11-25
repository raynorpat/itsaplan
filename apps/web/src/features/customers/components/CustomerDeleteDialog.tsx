'use client';

import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useDeleteCustomer, type Customer } from '@/services/customers.service';

// Deletes the customer. Its people and requests stay, without a customer; a portal board
// for it is shown to no one until it gets another customer.
export default function CustomerDeleteDialog({
  customer,
  onClose,
  onDeleted,
}: {
  customer: Customer;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const remove = useDeleteCustomer();
  return (
    <ConfirmDialog
      title="Delete customer"
      confirmLabel="Delete"
      onClose={onClose}
      onConfirm={async () => {
        await remove.mutateAsync(customer.id);
        onDeleted();
      }}
    >
      <p className="text-sm text-muted-foreground">
        {customer.name} is deleted. Its people and their requests are kept without a customer, and a
        portal board for it is shown to no one until it gets another customer.
      </p>
    </ConfirmDialog>
  );
}
