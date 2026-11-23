import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  childRelations,
  linkIdOf,
  linkableProjects,
  subInitiativeCandidates,
} from '../initiativeLinks';

// The links behind an initiative's Projects and Sub-initiatives sections: which link
// or relation a remove deletes, and which projects and initiatives an add offers.

describe('linkIdOf', () => {
  it("finds the project's link to this initiative", () => {
    const project = {
      initiativeToProjects: [
        { id: 'l1', initiativeId: 'other' },
        { id: 'l2', initiativeId: 'n1' },
      ],
    };
    assert.equal(linkIdOf(project, 'n1'), 'l2');
  });

  it('is null when the project is linked through a sub-initiative only', () => {
    assert.equal(
      linkIdOf({ initiativeToProjects: [{ id: 'l1', initiativeId: 'n2' }] }, 'n1'),
      null,
    );
  });
});

describe('childRelations', () => {
  it('keeps the relations whose parent is the initiative, by child id', () => {
    const relations = [
      { id: 'r1', initiativeId: 'n1', relatedInitiativeId: 'c1' },
      { id: 'r2', initiativeId: 'c1', relatedInitiativeId: 'g1' },
      { id: 'r3', initiativeId: 'n1', relatedInitiativeId: 'c2' },
    ];
    assert.deepEqual(
      childRelations(relations, 'n1'),
      new Map([
        ['c1', 'r1'],
        ['c2', 'r3'],
      ]),
    );
  });
});

describe('linkableProjects', () => {
  it('offers the projects not linked yet', () => {
    const all = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    assert.deepEqual(
      linkableProjects(all, new Set(['p2'])).map((p) => p.id),
      ['p1', 'p3'],
    );
  });
});

describe('subInitiativeCandidates', () => {
  // root → n1 → c1; loose has no parent; other → taken.
  const all = [
    { id: 'root', parentId: null },
    { id: 'n1', parentId: 'root' },
    { id: 'c1', parentId: 'n1' },
    { id: 'loose', parentId: null },
    { id: 'other', parentId: null },
    { id: 'taken', parentId: 'other' },
  ];

  it('offers initiatives without a parent that are not the initiative or above it', () => {
    assert.deepEqual(
      subInitiativeCandidates(all, 'n1').map((i) => i.id),
      ['loose', 'other'],
    );
  });

  it('does not follow a parent loop forever', () => {
    const looped = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
      { id: 'free', parentId: null },
    ];
    assert.deepEqual(
      subInitiativeCandidates(looped, 'a').map((i) => i.id),
      ['free'],
    );
  });
});
