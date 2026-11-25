// A customer page's data: its people through the instance plugin (the requesters list
// filtered by customer, since Linear's schema has no query for ExternalUser) and its
// requests through /graphql (customerNeeds filtered by customer).

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { gqlRequest, graphql } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import type { CustomerNeedIssue } from '../utils/customers';

export interface CustomerPerson {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  source: 'domain' | 'manual' | null;
}

interface RequesterDto {
  id: string;
  name: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  customer: { id: string; source: 'domain' | 'manual' } | null;
}

export function useCustomerPeople(customerId: string, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: [...qk.requesterList(`customer:${customerId}`)],
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ customerId });
      if (pageParam) params.set('cursor', pageParam);
      const res = await instanceFetch<{ requesters: RequesterDto[]; nextCursor: string | null }>(
        `/instance/requesters?${params.toString()}`,
      );
      return {
        people: res.requesters.map((r): CustomerPerson => ({
          id: r.id,
          name: r.displayName || r.name,
          email: r.email,
          avatarUrl: r.avatarUrl,
          source: r.customer?.source ?? null,
        })),
        nextCursor: res.nextCursor,
      };
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  return { ...query, people: query.data?.pages.flatMap((p) => p.people) ?? [] };
}

const CustomerNeedsPage = graphql(`
  query CustomerNeedsPage($filter: CustomerNeedFilter, $after: String, $first: Int) {
    customerNeeds(filter: $filter, after: $after, first: $first) {
      nodes {
        id
        priority
        createdAt
        issue {
          id
          identifier
          title
          state {
            name
            type
            color
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

export interface CustomerNeed {
  issue: CustomerNeedIssue | null;
  priority: number;
  createdAt: string;
}

// Every active request of the customer on issues the viewer can see.
export function useCustomerNeeds(customerId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.anyCustomers, 'needs', customerId],
    enabled,
    queryFn: async (): Promise<CustomerNeed[]> => {
      const nodes = await fetchAllPages(async (after, first) => {
        const data = await gqlRequest(CustomerNeedsPage, {
          filter: { customer: { id: { eq: customerId } } },
          after,
          first,
        });
        return data.customerNeeds;
      });
      return nodes.map((n) => ({
        priority: n.priority,
        createdAt: n.createdAt,
        issue: n.issue
          ? {
              id: n.issue.id,
              identifier: n.issue.identifier,
              title: n.issue.title,
              state: {
                name: n.issue.state.name,
                type: n.issue.state.type as CustomerNeedIssue['state']['type'],
                color: n.issue.state.color,
              },
            }
          : null,
      }));
    },
  });
}
