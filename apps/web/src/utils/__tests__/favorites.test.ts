import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendedOrders,
  dropTarget,
  favoriteHref,
  favoriteLabel,
  favoriteTree,
  sortOrderForDrop,
  type FavoriteItem,
} from '@/utils/favorites';

const fav = (over: Partial<FavoriteItem>): FavoriteItem => ({
  id: 'f',
  type: 'issue',
  folderName: null,
  sortOrder: 1000,
  url: null,
  parentId: null,
  predefinedViewType: null,
  ...over,
});

describe('favoriteTree', () => {
  it('nests children under folders in sortOrder', () => {
    const tree = favoriteTree([
      fav({ id: 'b', sortOrder: 2000 }),
      fav({ id: 'folder', type: 'folder', folderName: 'Work', sortOrder: 1000 }),
      fav({ id: 'c2', parentId: 'folder', sortOrder: 2000 }),
      fav({ id: 'c1', parentId: 'folder', sortOrder: 1000 }),
      fav({ id: 'a', sortOrder: 500 }),
    ]);
    assert.deepEqual(
      tree.map((n) => [n.favorite.id, n.children.map((c) => c.id)]),
      [
        ['a', []],
        ['folder', ['c1', 'c2']],
        ['b', []],
      ],
    );
  });

  it('shows a child whose folder is missing at the top level', () => {
    const tree = favoriteTree([fav({ id: 'x', parentId: 'gone' })]);
    assert.deepEqual(
      tree.map((n) => n.favorite.id),
      ['x'],
    );
  });
});

describe('sortOrderForDrop', () => {
  it('places items between their neighbours, never NaN', () => {
    assert.equal(sortOrderForDrop([], 0), 1000);
    assert.equal(sortOrderForDrop([1000], 0), 0);
    assert.equal(sortOrderForDrop([1000], 1), 2000);
    assert.equal(sortOrderForDrop([1000, 2000], 1), 1500);
    assert.equal(sortOrderForDrop([1000, 2000], 2), 3000);
  });

  it('clamps an index past either end', () => {
    assert.equal(sortOrderForDrop([1000], 5), 2000);
    assert.equal(sortOrderForDrop([1000], -1), 0);
  });
});

describe('appendedOrders', () => {
  it('puts moved favorites after the last top-level one, in order', () => {
    assert.deepEqual(appendedOrders([500, 3000], 2), [4000, 5000]);
    assert.deepEqual(appendedOrders([], 2), [1000, 2000]);
  });
});

describe('favoriteHref', () => {
  it('makes the API URL relative to the app', () => {
    assert.equal(
      favoriteHref(fav({ url: 'https://app.example.com/team/ENG/issue/12?x=1' })),
      '/team/ENG/issue/12?x=1',
    );
  });

  it('has no link for folders and kinds without a page', () => {
    assert.equal(favoriteHref(fav({ type: 'folder', url: null })), null);
    assert.equal(favoriteHref(fav({ type: 'label', url: null })), null);
  });
});

describe('favoriteLabel', () => {
  it('names each kind', () => {
    const dashboards = new Map([['d1', 'Delivery']]);
    assert.equal(
      favoriteLabel(fav({ issue: { identifier: 'ENG-1', title: 'Fix login' } }), dashboards),
      'ENG-1 Fix login',
    );
    assert.equal(favoriteLabel(fav({ type: 'folder', folderName: 'Work' }), dashboards), 'Work');
    assert.equal(
      favoriteLabel(fav({ type: 'cycle', cycle: { number: 4, name: null } }), dashboards),
      'Cycle 4',
    );
    assert.equal(
      favoriteLabel(fav({ type: 'predefinedView', predefinedViewType: 'myIssues' }), dashboards),
      'My issues',
    );
  });

  it('names a dashboard from the dashboards list by the id in its URL', () => {
    const dashboards = new Map([['d1', 'Delivery']]);
    assert.equal(
      favoriteLabel(fav({ type: 'dashboard', url: 'https://a.b/dashboards/d1' }), dashboards),
      'Delivery',
    );
    assert.equal(
      favoriteLabel(fav({ type: 'dashboard', url: 'https://a.b/dashboards/zz' }), dashboards),
      'Dashboard',
    );
  });
});

describe('dropTarget', () => {
  const tree = favoriteTree([
    fav({ id: 'a', sortOrder: 1000 }),
    fav({ id: 'folder', type: 'folder', folderName: 'Work', sortOrder: 2000 }),
    fav({ id: 'c1', parentId: 'folder', sortOrder: 1000 }),
    fav({ id: 'c2', parentId: 'folder', sortOrder: 2000 }),
    fav({ id: 'b', sortOrder: 3000 }),
  ]);

  it('reorders within the top level', () => {
    const t = dropTarget(tree, 'b', 'a');
    assert.deepEqual(t, { parentId: null, index: 0, siblings: [1000, 2000] });
    assert.equal(sortOrderForDrop(t!.siblings, t!.index), 0);
  });

  it('moves a favorite into a folder dropped on the folder row, at the end', () => {
    const t = dropTarget(tree, 'a', 'folder');
    assert.deepEqual(t, { parentId: 'folder', index: 2, siblings: [1000, 2000] });
    assert.equal(sortOrderForDrop(t!.siblings, t!.index), 3000);
  });

  it('moves a favorite into a folder at a child position', () => {
    assert.deepEqual(dropTarget(tree, 'b', 'c2'), {
      parentId: 'folder',
      index: 1,
      siblings: [1000, 2000],
    });
  });

  it('moves a child out of its folder onto a top-level favorite', () => {
    const t = dropTarget(tree, 'c1', 'b');
    assert.deepEqual(t, { parentId: null, index: 2, siblings: [1000, 2000, 3000] });
    assert.equal(sortOrderForDrop(t!.siblings, t!.index), 2500);
  });

  it('keeps folders at the top level', () => {
    assert.deepEqual(dropTarget(tree, 'folder', 'c1'), {
      parentId: null,
      index: 1,
      siblings: [1000, 3000],
    });
    assert.deepEqual(dropTarget(tree, 'folder', 'b'), {
      parentId: null,
      index: 2,
      siblings: [1000, 3000],
    });
  });

  it('does nothing on itself or an unknown target', () => {
    assert.equal(dropTarget(tree, 'a', 'a'), null);
    assert.equal(dropTarget(tree, 'a', 'zz'), null);
  });

  it('moves into an empty folder', () => {
    const t2 = favoriteTree([
      fav({ id: 'a', sortOrder: 1000 }),
      fav({ id: 'f', type: 'folder', folderName: 'Empty', sortOrder: 2000 }),
    ]);
    const t = dropTarget(t2, 'a', 'f');
    assert.deepEqual(t, { parentId: 'f', index: 0, siblings: [] });
    assert.equal(sortOrderForDrop(t!.siblings, t!.index), 1000);
  });
});
