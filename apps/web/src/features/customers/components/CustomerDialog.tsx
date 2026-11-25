'use client';

import { useState } from 'react';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCreateCustomer,
  useCustomerStatuses,
  useCustomerTiers,
  type Customer,
} from '@/services/customers.service';
import { parseDomains, parseWholeNumber } from '../utils/customers';
import CustomerListPick from './CustomerListPick';
import CustomerOwnerPick from './CustomerOwnerPick';

// New customer: name, email domains, status (the default status when not picked), tier,
// owner, revenue and size. The API's refusal (a taken or public domain) is shown by the
// global error toast and the dialog stays open.
export default function CustomerDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (customer: Customer) => void;
}) {
  const statuses = useCustomerStatuses().data ?? [];
  const tiers = useCustomerTiers().data ?? [];
  const create = useCreateCustomer();
  const [name, setName] = useState('');
  const [domains, setDomains] = useState('');
  const [statusId, setStatusId] = useState<string | null>(null);
  const [tierId, setTierId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [revenue, setRevenue] = useState('');
  const [size, setSize] = useState('');
  const revenueValue = parseWholeNumber(revenue);
  const sizeValue = parseWholeNumber(size);
  const valid = name.trim() !== '' && revenueValue !== undefined && sizeValue !== undefined;

  function submit() {
    if (!valid || create.isPending) return;
    create.mutate(
      {
        name: name.trim(),
        domains: parseDomains(domains),
        ...(statusId ? { statusId } : {}),
        tierId,
        ownerId,
        revenue: revenueValue ?? null,
        size: sizeValue ?? null,
      },
      { onSuccess: (customer) => customer && onCreated(customer) },
    );
  }

  return (
    <Modal title="New customer" onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Label className="flex flex-col items-start gap-1.5">
          Name
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Label>
        <Label className="flex flex-col items-start gap-1.5">
          Email domains
          <Input
            placeholder="acme.com, acme.io"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
          />
        </Label>
        <div className="flex flex-wrap gap-2">
          <CustomerListPick
            label="Status"
            items={statuses}
            value={statusId ?? statuses[0]?.id ?? null}
            onChange={setStatusId}
          />
          <CustomerListPick
            label="Tier"
            items={tiers}
            value={tierId}
            onChange={setTierId}
            noneLabel="No tier"
          />
          <CustomerOwnerPick value={ownerId} onChange={setOwnerId} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Label className="flex flex-col items-start gap-1.5">
            Revenue
            <Input
              inputMode="numeric"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
            />
          </Label>
          <Label className="flex flex-col items-start gap-1.5">
            Size
            <Input inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} />
          </Label>
        </div>
        {(revenueValue === undefined || sizeValue === undefined) && (
          <p className="text-xs text-destructive">Revenue and size are whole numbers.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!valid || create.isPending}>
            Create customer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
