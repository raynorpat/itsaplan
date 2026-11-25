// Linear's Favorites in the sidebar: the tree of folders and favorites, sparse sort
// orders for drag and drop, and each favorite's link and name. The API lists every
// favorite flat (folder children carry `parentId`), in no particular order.

export interface FavoriteItem {
  id: string;
  type: string;
  folderName: string | null;
  sortOrder: number;
  url: string | null;
  parentId: string | null;
  predefinedViewType: string | null;
  issue?: { identifier: string; title: string } | null;
  project?: { name: string } | null;
  customView?: { name: string } | null;
  cycle?: { number: number; name: string | null } | null;
  document?: { title: string } | null;
  label?: { name: string; color: string } | null;
  projectLabel?: { name: string; color: string } | null;
  customer?: { name: string } | null;
  team?: { key: string; name: string } | null;
  user?: { name: string } | null;
  predefinedViewTeam?: { key: string; name: string } | null;
}

export interface FavoriteNode<T extends FavoriteItem = FavoriteItem> {
  favorite: T;
  children: T[];
}

const STEP = 1000;

const bySortOrder = (a: FavoriteItem, b: FavoriteItem) => a.sortOrder - b.sortOrder;

// Top-level favorites and folders in order, each folder with its children in order.
// A child whose folder is not in the list shows at the top level.
export function favoriteTree<T extends FavoriteItem>(list: T[]): FavoriteNode<T>[] {
  const folders = new Set(list.filter((f) => f.type === 'folder').map((f) => f.id));
  const children = new Map<string, T[]>();
  const top: T[] = [];
  for (const f of list) {
    if (f.parentId && folders.has(f.parentId)) {
      children.set(f.parentId, [...(children.get(f.parentId) ?? []), f]);
    } else {
      top.push(f);
    }
  }
  return top.sort(bySortOrder).map((favorite) => ({
    favorite,
    children: (children.get(favorite.id) ?? []).sort(bySortOrder),
  }));
}

// The sort order for an item dropped at `index` among `siblings` (their sort orders,
// ascending, without the dropped item): halfway between its new neighbours, or one
// step past the first or last.
export function sortOrderForDrop(siblings: number[], index: number): number {
  if (siblings.length === 0) return STEP;
  const at = Math.max(0, Math.min(index, siblings.length));
  if (at === 0) return siblings[0]! - STEP;
  if (at === siblings.length) return siblings[siblings.length - 1]! + STEP;
  return (siblings[at - 1]! + siblings[at]!) / 2;
}

// Sort orders for `count` favorites appended after the top-level ones, in order (a
// deleted folder's favorites move to the top level this way).
export function appendedOrders(topLevel: number[], count: number): number[] {
  const last = topLevel.length > 0 ? Math.max(...topLevel) : 0;
  return Array.from({ length: count }, (_, i) => last + STEP * (i + 1));
}

// The favorite's page in this app: the API's absolute URL made relative. Folders,
// labels, project labels and people have no page.
export function favoriteHref(f: FavoriteItem): string | null {
  if (!f.url) return null;
  try {
    const url = new URL(f.url);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

const PREDEFINED_LABELS: Record<string, string> = {
  myIssues: 'My issues',
  inbox: 'Inbox',
  projects: 'Projects',
  views: 'Views',
  initiatives: 'Initiatives',
  dashboards: 'Dashboards',
};

// The dashboard id at the end of a dashboard favorite's URL (/dashboards/<id>).
export function dashboardIdFromUrl(url: string | null): string | null {
  const match = url ? /\/dashboards\/([^/?#]+)/.exec(url) : null;
  return match ? decodeURIComponent(match[1]!) : null;
}

// The favorite's name in the sidebar. `dashboards` maps dashboard ids to names, since
// Linear's Favorite type has no dashboard field.
export function favoriteLabel(f: FavoriteItem, dashboards: Map<string, string>): string {
  switch (f.type) {
    case 'folder':
      return f.folderName ?? 'Folder';
    case 'issue':
      return f.issue ? `${f.issue.identifier} ${f.issue.title}` : 'Issue';
    case 'project':
      return f.project?.name ?? 'Project';
    case 'customView':
      return f.customView?.name ?? 'View';
    case 'cycle':
      return f.cycle ? f.cycle.name || `Cycle ${f.cycle.number}` : 'Cycle';
    case 'document':
      return f.document?.title || 'Untitled document';
    case 'label':
      return f.label?.name ?? 'Label';
    case 'projectLabel':
      return f.projectLabel?.name ?? 'Project label';
    case 'customer':
      return f.customer?.name ?? 'Customer';
    case 'team':
      return f.team?.name ?? 'Team';
    case 'user':
      return f.user?.name ?? 'Person';
    case 'dashboard': {
      const id = dashboardIdFromUrl(f.url);
      return (id && dashboards.get(id)) || 'Dashboard';
    }
    case 'predefinedView': {
      const view = PREDEFINED_LABELS[f.predefinedViewType ?? ''] ?? 'View';
      return f.predefinedViewTeam ? `${f.predefinedViewTeam.name} · ${view}` : view;
    }
    default:
      return 'Favorite';
  }
}

export interface DropTarget {
  // The folder the dragged favorite lands in, or null for the top level.
  parentId: string | null;
  // Its position among `siblings`, the destination's sort orders without it.
  index: number;
  siblings: number[];
}

// Where a favorite dragged onto `overId` lands. Within one list it takes the target's
// place (dnd-kit's arrayMove); into another list it goes before the target. Dropped
// on a folder's row, a favorite goes to the end of that folder. Folders stay at the
// top level (they cannot be nested), taking the place of the target's top-level row.
export function dropTarget(
  tree: FavoriteNode[],
  activeId: string,
  overId: string,
): DropTarget | null {
  if (activeId === overId) return null;
  const top = tree.map((n) => n.favorite);
  const parentOf = new Map<string, string | null>();
  for (const n of tree) {
    parentOf.set(n.favorite.id, null);
    for (const c of n.children) parentOf.set(c.id, n.favorite.id);
  }
  if (!parentOf.has(activeId) || !parentOf.has(overId)) return null;
  const active = [...top, ...tree.flatMap((n) => n.children)].find((f) => f.id === activeId)!;
  const listOf = (parentId: string | null): FavoriteItem[] =>
    parentId === null ? top : (tree.find((n) => n.favorite.id === parentId)?.children ?? []);
  const place = (parentId: string | null, targetId: string): DropTarget => {
    const list = listOf(parentId);
    const index = list.findIndex((f) => f.id === targetId);
    const siblings = list.filter((f) => f.id !== activeId).map((f) => f.sortOrder);
    return { parentId, index, siblings };
  };

  if (active.type === 'folder') {
    const overParent = parentOf.get(overId) ?? null;
    return place(null, overParent ?? overId);
  }
  const over = top.find((f) => f.id === overId);
  if (over?.type === 'folder' && parentOf.get(activeId) !== overId) {
    const siblings = listOf(overId).map((f) => f.sortOrder);
    return { parentId: overId, index: siblings.length, siblings };
  }
  return place(parentOf.get(overId) ?? null, overId);
}
