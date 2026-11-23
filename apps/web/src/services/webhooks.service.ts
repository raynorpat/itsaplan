import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NewWebhookInput, Webhook, WebhookPatch, WebhookResourceType } from '@/lib/api';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';

const TeamWebhooksPage = graphql(`
  query TeamWebhooks($teamKey: String!, $after: String, $first: Int) {
    team(id: $teamKey) {
      webhooks(first: $first, after: $after) {
        nodes {
          id
          url
          label
          secret
          resourceTypes
          enabled
          allPublicTeams
          createdAt
          updatedAt
          team {
            id
          }
          creator {
            id
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);

const WebhooksPage = graphql(`
  query AllTeamsWebhooks($after: String, $first: Int) {
    webhooks(first: $first, after: $after) {
      nodes {
        id
        url
        label
        secret
        resourceTypes
        enabled
        allPublicTeams
        createdAt
        updatedAt
        team {
          id
        }
        creator {
          id
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

const WebhookCreate = graphql(`
  mutation WebhookCreate($input: WebhookCreateInput!) {
    webhookCreate(input: $input) {
      success
    }
  }
`);

const WebhookUpdate = graphql(`
  mutation WebhookUpdate($id: String!, $input: WebhookUpdateInput!) {
    webhookUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const WebhookRotateSecret = graphql(`
  mutation WebhookRotateSecret($id: String!) {
    webhookRotateSecret(id: $id) {
      secret
    }
  }
`);

const WebhookDelete = graphql(`
  mutation WebhookDelete($id: String!) {
    webhookDelete(id: $id) {
      success
    }
  }
`);

type WebhookNode = {
  id: string;
  url?: string | null;
  label?: string | null;
  secret?: string | null;
  resourceTypes: string[];
  enabled: boolean;
  allPublicTeams: boolean;
  createdAt: string;
  updatedAt: string;
  team?: { id: string } | null;
  creator?: { id: string } | null;
};

function toWebhook(node: WebhookNode): Webhook {
  return {
    id: node.id,
    teamId: node.team?.id ?? null,
    allPublicTeams: node.allPublicTeams,
    url: node.url ?? '',
    label: node.label ?? null,
    secret: node.secret ?? '',
    resourceTypes: node.resourceTypes as WebhookResourceType[],
    enabled: node.enabled,
    creatorUserId: node.creator?.id ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

export function useWebhooksQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.webhooks(teamKey ?? ''),
    queryFn: async () =>
      (
        await fetchAllPages(
          async (after, first) =>
            (await gqlRequest(TeamWebhooksPage, { teamKey: teamKey!, after, first })).team.webhooks,
        )
      ).map(toWebhook),
    enabled: teamKey != null,
  });
}

// All-teams webhooks, for workspace admins and owners (the API lists them only to
// those). `webhooks` also returns the team webhooks the viewer may manage, so the
// all-teams ones are picked out here.
export function useAllTeamsWebhooksQuery(enabled: boolean) {
  return useQuery({
    queryKey: qk.allTeamsWebhooks,
    queryFn: async () =>
      (
        await fetchAllPages(
          async (after, first) => (await gqlRequest(WebhooksPage, { after, first })).webhooks,
        )
      )
        .filter((w) => w.allPublicTeams)
        .map(toWebhook),
    enabled,
  });
}

// Every webhook mutation refreshes the team list and the all-teams list (both are
// under the 'webhooks' key).
function useInvalidateWebhooks() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['webhooks'] });
}

export function useCreateWebhook(teamId: string) {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationFn: ({ input, allTeams }: { input: NewWebhookInput; allTeams: boolean }) =>
      gqlRequest(WebhookCreate, {
        input: { ...input, ...(allTeams ? { allPublicTeams: true } : { teamId }) },
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateWebhook() {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: WebhookPatch }) =>
      gqlRequest(WebhookUpdate, { id, input }),
    onSuccess: invalidate,
  });
}

export function useRotateWebhookSecret() {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationFn: (id: string) => gqlRequest(WebhookRotateSecret, { id }),
    onSuccess: invalidate,
  });
}

export function useDeleteWebhook() {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationFn: (id: string) => gqlRequest(WebhookDelete, { id }),
    onSuccess: invalidate,
  });
}
