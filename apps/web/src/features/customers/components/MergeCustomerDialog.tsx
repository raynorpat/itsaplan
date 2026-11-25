'use client';

import { useState } from 'react';
import CustomerPicker from '@/components/common/feedback/CustomerPicker';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import Modal from '@/components/common/overlay/Modal';
import { useMergeCustomers, type Customer } from '@/services/customers.service';

// Merges this customer into another: pick the customer to keep, then confirm. The kept
// customer takes this one's people, requests, domains and portal boards.
export default function MergeCustomerDialog({
  customer,
  onClose,
  onMerged,
}: {
  customer: Customer;
  onClose: () => void;
  onMerged: (kept: Customer) => void;
}) {
  const [into, setInto] = useState<Customer | null>(null);
  const merge = useMergeCustomers();

  if (!into)
    return (
      <Modal title={`Merge ${customer.name} into…`} onClose={onClose}>
        <CustomerPicker excludeId={customer.id} onPick={setInto} />
      </Modal>
    );

  return (
    <ConfirmDialog
      title="Merge customers"
      confirmLabel="Merge"
      onClose={onClose}
      onConfirm={async () => {
        const kept = await merge.mutateAsync({
          sourceCustomerId: customer.id,
          targetCustomerId: into.id,
        });
        onMerged(kept ?? into);
      }}
    >
      <p className="text-sm text-muted-foreground">
        {into.name} takes {customer.name}’s people, requests, email domains and portal boards, and{' '}
        {customer.name} is deleted. This cannot be undone.
      </p>
    </ConfirmDialog>
  );
}
