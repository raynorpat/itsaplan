'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { instanceFetch, useSession } from '@/lib/auth-client';
import { ApiError, gqlRequest, graphql, readFragment, type ResultOf } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';

// Linear's Customers: companies that group the people who give feedback. Customers,
// statuses and tiers come from /graphql; the on / off switch, the revenue currency and
// a person's customer come from the instance plugin (/api/auth/instance/*), since
// Linear's schema cannot set them.

export interface CustomersSettings {
  enabled: boolean;
  revenueCurrency: string;
}

const CustomersSwitch = graphql(`
  query CustomersSwitch {
    organization {
      customersEnabled
      customersConfiguration
    }
  }
`);

// The number of people of each customer (Linear's Customer has no such field).
export function useCustomerPeopleCounts(enabled = true) {
  return useQuery({
    queryKey: qk.customerPeopleCounts,
    queryFn: async () =>
      (await instanceFetch<{ counts: Record<string, number> }>('/instance/customers/people-counts'))
        .counts,
    enabled,
  });
}

// Whether Customers is on, and the revenue currency, for any signed-in user.
export function useCustomersSettings() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: qk.customersSettings,
    queryFn: async (): Promise<CustomersSettings> => {
      const data = await gqlRequest(CustomersSwitch);
      const config = data.organization.customersConfiguration as { revenueCurrency?: string };
      return {
        enabled: data.organization.customersEnabled,
        revenueCurrency: config.revenueCurrency ?? 'USD',
      };
    },
    enabled: Boolean(session),
  });
}

export function useSaveCustomersSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CustomersSettings>) =>
      instanceFetch<CustomersSettings>('/instance/customers-settings/save', {
        method: 'POST',
        body: input,
      }),
    onSuccess: (data) => {
      qc.setQueryData(qk.customersSettings, data);
      // Turning Customers on creates the default statuses and matches every person.
      void qc.invalidateQueries({ queryKey: qk.anyCustomers });
      void qc.invalidateQueries({ queryKey: qk.anyRequesters });
    },
  });
}

// --- Statuses and tiers -------------------------------------------------------------

export interface CustomerListItem {
  id: string;
  name: string;
  displayName: string;
  color: string;
  description: string | null;
  position: number;
}

export type CustomerListKind = 'status' | 'tier';

const StatusesQuery = graphql(`
  query CustomerStatuses {
    customerStatuses(first: 250) {
      nodes {
        id
        name
        displayName
        color
        description
        position
      }
    }
  }
`);

const TiersQuery = graphql(`
  query CustomerTiers {
    customerTiers(first: 250) {
      nodes {
        id
        name
        displayName
        color
        description
        position
      }
    }
  }
`);

const byPosition = (items: CustomerListItem[]) =>
  [...items].sort((a, b) => a.position - b.position);

export function useCustomerStatuses(enabled = true) {
  return useQuery({
    queryKey: qk.customerStatuses,
    queryFn: async () => byPosition((await gqlRequest(StatusesQuery)).customerStatuses.nodes),
    enabled,
  });
}

export function useCustomerTiers(enabled = true) {
  return useQuery({
    queryKey: qk.customerTiers,
    queryFn: async () => byPosition((await gqlRequest(TiersQuery)).customerTiers.nodes),
    enabled,
  });
}

export interface CustomerListItemInput {
  name?: string;
  color?: string;
  description?: string | null;
  position?: number;
}

const StatusCreate = graphql(`
  mutation CustomerStatusCreate($input: CustomerStatusCreateInput!) {
    customerStatusCreate(input: $input) {
      success
    }
  }
`);
const StatusUpdate = graphql(`
  mutation CustomerStatusUpdate($id: String!, $input: CustomerStatusUpdateInput!) {
    customerStatusUpdate(id: $id, input: $input) {
      success
    }
  }
`);
const StatusDelete = graphql(`
  mutation CustomerStatusDelete($id: String!) {
    customerStatusDelete(id: $id) {
      success
    }
  }
`);
const TierCreate = graphql(`
  mutation CustomerTierCreate($input: CustomerTierCreateInput!) {
    customerTierCreate(input: $input) {
      success
    }
  }
`);
const TierUpdate = graphql(`
  mutation CustomerTierUpdate($id: String!, $input: CustomerTierUpdateInput!) {
    customerTierUpdate(id: $id, input: $input) {
      success
    }
  }
`);
const TierDelete = graphql(`
  mutation CustomerTierDelete($id: String!) {
    customerTierDelete(id: $id) {
      success
    }
  }
`);

// Statuses and tiers are written the same way; a status or tier delete also changes
// customers (moved to the default status, tier cleared), so customers are refetched.
export function useCustomerListWrites(kind: CustomerListKind) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.anyCustomers });
  };
  const create = useMutation({
    mutationFn: async (input: CustomerListItemInput & { name: string; color: string }) => {
      if (kind === 'status') await gqlRequest(StatusCreate, { input });
      else await gqlRequest(TierCreate, { input });
    },
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: CustomerListItemInput }) => {
      if (kind === 'status') await gqlRequest(StatusUpdate, { id, input });
      else await gqlRequest(TierUpdate, { id, input });
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (kind === 'status') await gqlRequest(StatusDelete, { id });
      else await gqlRequest(TierDelete, { id });
    },
    onSuccess: refresh,
  });
  return { create, update, remove };
}

// --- Customers ----------------------------------------------------------------------

export const CustomerFields = graphql(`
  fragment CustomerFields on Customer {
    id
    slugId
    name
    domains
    externalIds
    revenue
    size
    logoUrl
    url
    approximateNeedCount
    createdAt
    status {
      id
      name
      displayName
      color
    }
    tier {
      id
      name
      displayName
      color
    }
    owner {
      id
      name
      displayName
      avatarUrl
    }
  }
`);

export type Customer = ResultOf<typeof CustomerFields>;

const CustomersPage = graphql(
  `
    query CustomersPage($filter: CustomerFilter, $after: String, $first: Int) {
      customers(filter: $filter, after: $after, first: $first) {
        nodes {
          ...CustomerFields
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  [CustomerFields],
);

const CustomerQuery = graphql(
  `
    query CustomerOne($id: String!) {
      customer(id: $id) {
        ...CustomerFields
      }
    }
  `,
  [CustomerFields],
);

// Every customer matching `filter` (Linear's CustomerFilter), loaded page by page.
export async function fetchCustomers(filter?: Record<string, unknown>): Promise<Customer[]> {
  const nodes = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(CustomersPage, { filter, after, first });
    return data.customers;
  });
  return nodes.map((n) => readFragment(CustomerFields, n));
}

export function useCustomers(filter?: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: qk.customerList(JSON.stringify(filter ?? {})),
    queryFn: () => fetchCustomers(filter),
    enabled,
  });
}

// One customer by id or slugId; null when it does not exist (or Customers is off).
export function useCustomer(idOrSlug: string, enabled = true) {
  return useQuery({
    queryKey: qk.customer(idOrSlug),
    queryFn: async (): Promise<Customer | null> => {
      try {
        const data = await gqlRequest(CustomerQuery, { id: idOrSlug });
        return readFragment(CustomerFields, data.customer);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled,
  });
}

export interface CustomerInput {
  name?: string;
  domains?: string[];
  statusId?: string;
  tierId?: string | null;
  ownerId?: string | null;
  revenue?: number | null;
  size?: number | null;
  logoUrl?: string | null;
}

const CustomerCreate = graphql(
  `
    mutation CustomerCreate($input: CustomerCreateInput!) {
      customerCreate(input: $input) {
        customer {
          ...CustomerFields
        }
      }
    }
  `,
  [CustomerFields],
);
const CustomerUpdate = graphql(
  `
    mutation CustomerUpdate($id: String!, $input: CustomerUpdateInput!) {
      customerUpdate(id: $id, input: $input) {
        customer {
          ...CustomerFields
        }
      }
    }
  `,
  [CustomerFields],
);
const CustomerDelete = graphql(`
  mutation CustomerDelete($id: String!) {
    customerDelete(id: $id) {
      success
    }
  }
`);
const CustomerMerge = graphql(
  `
    mutation CustomerMerge($sourceCustomerId: String!, $targetCustomerId: String!) {
      customerMerge(sourceCustomerId: $sourceCustomerId, targetCustomerId: $targetCustomerId) {
        customer {
          ...CustomerFields
        }
      }
    }
  `,
  [CustomerFields],
);

// Customer writes change who belongs to which customer, so people and their feedback
// are refetched as well.
function useCustomerWrite<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.anyCustomers });
      void qc.invalidateQueries({ queryKey: qk.anyRequesters });
      void qc.invalidateQueries({ queryKey: qk.anyFeedback });
    },
  });
}

export const useCreateCustomer = () =>
  useCustomerWrite(async (input: CustomerInput & { name: string }) => {
    const data = await gqlRequest(CustomerCreate, { input });
    const created = data.customerCreate.customer;
    return created ? readFragment(CustomerFields, created) : null;
  });

export const useUpdateCustomer = () =>
  useCustomerWrite(async ({ id, input }: { id: string; input: CustomerInput }) => {
    const data = await gqlRequest(CustomerUpdate, { id, input });
    const created = data.customerUpdate.customer;
    return created ? readFragment(CustomerFields, created) : null;
  });

export const useDeleteCustomer = () =>
  useCustomerWrite(async (id: string) => {
    await gqlRequest(CustomerDelete, { id });
  });

export const useMergeCustomers = () =>
  useCustomerWrite(async (vars: { sourceCustomerId: string; targetCustomerId: string }) => {
    const data = await gqlRequest(CustomerMerge, vars);
    const created = data.customerMerge.customer;
    return created ? readFragment(CustomerFields, created) : null;
  });

// A person's customer as the People endpoints return it.
export interface PersonCustomer {
  id: string;
  name: string;
  source: 'domain' | 'manual';
}

// Picks a person's customer by hand, or (null) clears the pick so their email domain
// decides again. Returns the person's customer afterwards.
export const useSetPersonCustomer = () =>
  useCustomerWrite(async (input: { id: string; customerId: string | null }) => {
    const data = await instanceFetch<{ requester: { customer: PersonCustomer | null } }>(
      '/instance/requesters/customer',
      { method: 'POST', body: input },
    );
    return data.requester.customer;
  });
