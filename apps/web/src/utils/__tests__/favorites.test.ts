import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyMove,
  dropTarget,
  dropZone,
  outOfFolderTarget,
  stepTarget,
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

describe('dropTarget zones on a folder row', () => {
  const tree = favoriteTree([
    fav({ id: 'folder', type: 'folder', folderName: 'Work', sortOrder: 1000 }),
    fav({ id: 'c1', parentId: 'folder', sortOrder: 1000 }),
    fav({ id: 'a', sortOrder: 2000 }),
  ]);

  it('puts a favorite above a folder from the top of its row', () => {
    const t = dropTarget(tree, 'a', 'folder', 'before');
    assert.deepEqual(t, { parentId: null, index: 0, siblings: [1000] });
    assert.ok(sortOrderForDrop(t!.siblings, t!.index) < 1000);
  });

  it('puts a favorite below a folder from the bottom of its row', () => {
    const t = dropTarget(tree, 'a', 'folder', 'after');
    assert.deepEqual(t, { parentId: null, index: 1, siblings: [1000] });
  });

  it('puts it into the folder from the middle', () => {
    assert.deepEqual(dropTarget(tree, 'a', 'folder', 'into'), {
      parentId: 'folder',
      index: 1,
      siblings: [1000],
    });
  });
});

describe('dropZone', () => {
  it('splits a row into quarters', () => {
    const row = { top: 100, height: 40 };
    assert.equal(dropZone(row, 105), 'before');
    assert.equal(dropZone(row, 120), 'into');
    assert.equal(dropZone(row, 135), 'after');
  });
});

describe('stepTarget and outOfFolderTarget', () => {
  const tree = favoriteTree([
    fav({ id: 'a', sortOrder: 1000 }),
    fav({ id: 'b', sortOrder: 2000 }),
    fav({ id: 'folder', type: 'folder', folderName: 'Work', sortOrder: 3000 }),
    fav({ id: 'c1', parentId: 'folder', sortOrder: 1000 }),
    fav({ id: 'c2', parentId: 'folder', sortOrder: 2000 }),
  ]);

  it('moves a favorite up and down within its list', () => {
    const up = stepTarget(tree, 'b', 'up')!;
    assert.deepEqual(up, { parentId: null, index: 0, siblings: [1000, 3000] });
    assert.ok(sortOrderForDrop(up.siblings, up.index) < 1000);
    const down = stepTarget(tree, 'c1', 'down')!;
    assert.deepEqual(down, { parentId: 'folder', index: 1, siblings: [2000] });
    assert.ok(sortOrderForDrop(down.siblings, down.index) > 2000);
  });

  it('has no step past either end', () => {
    assert.equal(stepTarget(tree, 'a', 'up'), null);
    assert.equal(stepTarget(tree, 'c2', 'down'), null);
  });

  it('moves a child out of its folder to just below the folder', () => {
    const t = outOfFolderTarget(tree, 'c1')!;
    assert.deepEqual(t, { parentId: null, index: 3, siblings: [1000, 2000, 3000] });
    assert.ok(sortOrderForDrop(t.siblings, t.index) > 3000);
    assert.equal(outOfFolderTarget(tree, 'a'), null);
  });
});

describe('applyMove', () => {
  it('moves a favorite in the cached list at once', () => {
    const list = [fav({ id: 'a', sortOrder: 1000 }), fav({ id: 'b', sortOrder: 2000 })];
    const next = applyMove(list, 'b', { parentId: 'folder', sortOrder: 500 });
    assert.deepEqual(
      next.map((f) => [f.id, f.parentId, f.sortOrder]),
      [
        ['a', null, 1000],
        ['b', 'folder', 500],
      ],
    );
    assert.equal(list[1]!.parentId, null);
  });
});
