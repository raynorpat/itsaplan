'use client';

import { useCustomersSettings } from '@/services/customers.service';

// Whether Customers is on in the workspace. False while loading, so nothing about
// customers shows until the switch is known to be on.
export function useCustomersEnabled(): boolean {
  return useCustomersSettings().data?.enabled ?? false;
}
