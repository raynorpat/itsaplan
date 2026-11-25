'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { instanceFetch, useSession } from '@/lib/auth-client';
import { gqlRequest, graphql } from '@/lib/graphql';
import { usePermissions } from '@/hooks/usePermissions';
import { qk } from '@/services/queryKeys';
import {
  applyMove,
  dashboardIdFromUrl,
  sortOrderForDrop,
  type FavoriteItem,
} from '@/utils/favorites';

// The viewer's favorites through Linear's Favorite API (/graphql). A favorite points at
// one item (or is a folder); `favorites` lists them flat, folder children carrying
// their parent.

export type FavoriteKind =
  'issue' | 'project' | 'customView' | 'cycle' | 'document' | 'customer' | 'dashboard' | 'team';

export type FavoriteTarget =
  { kind: FavoriteKind; id: string } | { kind: 'predefinedView'; view: string; teamId?: string };

const FavoritesQuery = graphql(`
  query Favorites {
    favorites(first: 250) {
      nodes {
        id
        type
        folderName
        sortOrder
        url
        predefinedViewType
        parent {
          id
        }
        issue {
          id
          identifier
          title
        }
        project {
          id
          name
        }
        customView {
          id
          name
        }
        cycle {
          id
          number
          name
        }
        document {
          id
          title
        }
        label {
          id
          name
          color
        }
        projectLabel {
          id
          name
          color
        }
        customer {
          id
          name
        }
        team {
          id
          key
          name
        }
        user {
          id
          name
        }
        predefinedViewTeam {
          id
          key
          name
        }
      }
    }
  }
`);

const FavoriteCreate = graphql(`
  mutation FavoriteCreate($input: FavoriteCreateInput!) {
    favoriteCreate(input: $input) {
      favorite {
        id
      }
    }
  }
`);

const FavoriteUpdate = graphql(`
  mutation FavoriteUpdate($id: String!, $input: FavoriteUpdateInput!) {
    favoriteUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const FavoriteDelete = graphql(`
  mutation FavoriteDelete($id: String!) {
    favoriteDelete(id: $id) {
      success
    }
  }
`);

// The favorite's item as stored by the API: the id of its target (a dashboard's from
// its URL, since Linear's Favorite type has no dashboard field).
export interface Favorite extends FavoriteItem {
  targetId: string | null;
  teamId: string | null;
}

type Node = NonNullable<Awaited<ReturnType<typeof fetchFavorites>>>[number];

async function fetchFavorites() {
  return (await gqlRequest(FavoritesQuery)).favorites.nodes;
}

function toFavorite(n: Node): Favorite {
  const target =
    n.issue ?? n.project ?? n.customView ?? n.cycle ?? n.document ?? n.customer ?? n.team;
  return {
    id: n.id,
    type: n.type,
    folderName: n.folderName ?? null,
    sortOrder: n.sortOrder,
    url: n.url ?? null,
    parentId: n.parent?.id ?? null,
    predefinedViewType: n.predefinedViewType ?? null,
    issue: n.issue,
    project: n.project,
    customView: n.customView,
    cycle: n.cycle ? { number: n.cycle.number, name: n.cycle.name ?? null } : null,
    document: n.document,
    label: n.label,
    projectLabel: n.projectLabel,
    customer: n.customer,
    team: n.team,
    user: n.user,
    predefinedViewTeam: n.predefinedViewTeam,
    targetId: n.type === 'dashboard' ? dashboardIdFromUrl(n.url ?? null) : (target?.id ?? null),
    teamId: n.predefinedViewTeam?.id ?? null,
  };
}

export function useFavorites() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: qk.favorites,
    queryFn: async () => (await fetchFavorites()).map(toFavorite),
    enabled: Boolean(session),
  });
}

// Dashboard names for dashboard favorites (guests have no dashboards).
export function useDashboardNames(enabled: boolean): Map<string, string> {
  const { workspaceRole } = usePermissions();
  const query = useQuery({
    queryKey: qk.dashboards,
    queryFn: async () =>
      (await instanceFetch<{ dashboards: { id: string; name: string }[] }>('/instance/dashboards'))
        .dashboards,
    enabled: enabled && workspaceRole != null && workspaceRole !== 'guest',
  });
  return new Map((query.data ?? []).map((d) => [d.id, d.name]));
}

const matches = (f: Favorite, target: FavoriteTarget): boolean =>
  target.kind === 'predefinedView'
    ? f.type === 'predefinedView' &&
      f.predefinedViewType === target.view &&
      f.teamId === (target.teamId ?? null)
    : f.type === target.kind && f.targetId === target.id;

export function useFavoriteFor(target: FavoriteTarget | null): Favorite | null {
  const { data } = useFavorites();
  if (!target) return null;
  return data?.find((f) => matches(f, target)) ?? null;
}

function createInput(target: FavoriteTarget): Record<string, string> {
  if (target.kind === 'predefinedView')
    return {
      predefinedViewType: target.view,
      ...(target.teamId ? { predefinedViewTeamId: target.teamId } : {}),
    };
  return { [`${target.kind}Id`]: target.id };
}

// Every favorites change refetches the list and says when it failed.
function useFavoritesChange() {
  const qc = useQueryClient();
  return {
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Favorites were not changed'),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.favorites }),
  };
}

export function useToggleFavorite(target: FavoriteTarget) {
  const change = useFavoritesChange();
  const existing = useFavoriteFor(target);
  return useMutation({
    mutationFn: async () => {
      if (existing) await gqlRequest(FavoriteDelete, { id: existing.id });
      else await gqlRequest(FavoriteCreate, { input: createInput(target) });
    },
    ...change,
  });
}

export function useCreateFolder() {
  const change = useFavoritesChange();
  return useMutation({
    mutationFn: (folderName: string) => gqlRequest(FavoriteCreate, { input: { folderName } }),
    ...change,
  });
}

export function useRenameFolder() {
  const change = useFavoritesChange();
  return useMutation({
    mutationFn: ({ id, folderName }: { id: string; folderName: string }) =>
      gqlRequest(FavoriteUpdate, { id, input: { folderName } }),
    ...change,
  });
}

// Moves a favorite to `index` within `parentId` (null: the top level). `siblings`
// are the destination's sort orders without the moved favorite. The cached list moves
// at once, so a drop lands where it was let go; an error puts it back.
export function useMoveFavorite() {
  const qc = useQueryClient();
  const change = useFavoritesChange();
  return useMutation({
    mutationFn: ({
      id,
      parentId,
      sortOrder,
    }: {
      id: string;
      parentId: string | null;
      sortOrder: number;
    }) => gqlRequest(FavoriteUpdate, { id, input: { parentId, sortOrder } }),
    onMutate: async (move) => {
      await qc.cancelQueries({ queryKey: qk.favorites });
      const previous = qc.getQueryData<Favorite[]>(qk.favorites);
      if (previous) qc.setQueryData(qk.favorites, applyMove(previous, move.id, move));
      return { previous };
    },
    onError: (err, _move, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.favorites, ctx.previous);
      change.onError(err);
    },
    onSettled: change.onSettled,
  });
}

// The move to `index` among `siblings` as the parent and sort order to store.
export const moveTo = (move: { parentId: string | null; siblings: number[]; index: number }) => ({
  parentId: move.parentId,
  sortOrder: sortOrderForDrop(move.siblings, move.index),
});

export function useDeleteFavorite() {
  const change = useFavoritesChange();
  return useMutation({
    mutationFn: (id: string) => gqlRequest(FavoriteDelete, { id }),
    ...change,
  });
}

// Deleting a folder through Linear's API deletes its favorites, so the web uses the
// instance endpoint that moves every favorite in it (hidden ones too) to the top level
// first, in one request.
export function useDeleteFolder() {
  const change = useFavoritesChange();
  return useMutation({
    mutationFn: (folderId: string) =>
      instanceFetch('/instance/favorites/delete-folder', {
        method: 'POST',
        body: { id: folderId },
      }),
    ...change,
  });
}
