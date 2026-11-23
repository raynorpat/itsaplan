import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type FeedComment } from '@/utils/commentThreads';
import { buildFeed, type FeedHistory } from '../feed';

// buildFeed: the issue's comments and history (Linear's IssueHistory) as the feed the
// issue page renders, newest first, with replies under their thread and resolved
// threads marked.

const ISSUE = 'issue-1';
const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 9, minute)).toISOString();
const ann = { id: 'u1', name: 'Ann' };

function comment(id: string, minute: number, extra: Partial<FeedComment> = {}): FeedComment {
  return {
    id,
    body: `body ${id}`,
    createdAt: at(minute),
    editedAt: null,
    resolvedAt: null,
    parentId: null,
    user: ann,
    ...extra,
  };
}

function history(id: string, minute: number, extra: Partial<FeedHistory> = {}): FeedHistory {
  return { id, createdAt: at(minute), actor: ann, ...extra };
}

describe('buildFeed', () => {
  it('merges comments and history by time', () => {
    const feed = buildFeed(
      [comment('c1', 2), comment('c2', 4)],
      [history('h1', 1, { fromTitle: 'A', toTitle: 'B' }), history('h2', 3, { archived: true })],
      ISSUE,
    );
    assert.deepEqual(
      feed.map((e) => e.item.id),
      ['c2', 'h2', 'c1', 'h1'],
    );
    assert.equal(feed[0]!.item.kind, 'comment');
    assert.equal(feed[0]!.item.actorName, 'Ann');
    assert.equal(feed[1]!.item.kind, 'activity');
  });

  it('nests replies under their parent', () => {
    const feed = buildFeed(
      [
        comment('root', 1),
        comment('reply-1', 2, { parentId: 'root' }),
        comment('reply-2', 3, { parentId: 'root' }),
      ],
      [],
      ISSUE,
    );
    assert.equal(feed.length, 1);
    assert.equal(feed[0]!.item.id, 'root');
    // Replies read oldest first under their thread.
    assert.deepEqual(
      feed[0]!.replies.map((r) => r.id),
      ['reply-1', 'reply-2'],
    );
    assert.equal(feed[0]!.replies[0]!.parentId, 'root');
  });

  it('collapses resolved threads', () => {
    const feed = buildFeed(
      [
        comment('open', 1),
        comment('done', 2, { resolvedAt: at(5) }),
        comment('done-reply', 3, { parentId: 'done' }),
      ],
      [],
      ISSUE,
    );
    const byId = new Map(feed.map((e) => [e.item.id, e]));
    assert.equal(byId.get('done')!.resolved, true);
    assert.equal(byId.get('done')!.replies.length, 1);
    assert.equal(byId.get('open')!.resolved, false);
  });

  it('describes history entries', () => {
    const feed = buildFeed(
      [],
      [
        history('state', 9, {
          fromStateId: 's1',
          fromState: { name: 'Todo' },
          toStateId: 's2',
          toState: { name: 'Done' },
        }),
        history('assignee', 8, { toAssigneeId: 'u2', toAssignee: { name: 'Bo' } }),
        history('labels', 7, {
          addedLabelIds: ['l1'],
          addedLabels: [{ name: 'Bug' }],
          removedLabelIds: ['l2'],
          removedLabels: [{ name: 'Old' }],
        }),
        history('desc', 6, { updatedDescription: true }),
        history('gone', 5, {
          fromStateId: 's9',
          fromState: null,
          toStateId: 's2',
          toState: { name: 'Done' },
        }),
        history('unmatched', 4, {
          fromStateId: null,
          toStateId: null,
          toState: null,
          fromState: null,
        }),
        history('created', 3),
      ],
      ISSUE,
      { issueCreatedAt: at(3) },
    );
    const items = feed.map((e) => e.item);
    const find = (id: string) => items.find((i) => i.id === id)!;

    assert.deepEqual(
      [find('state').action, find('state').fromText, find('state').toText],
      ['status', 'Todo', 'Done'],
    );
    assert.deepEqual([find('assignee').action, find('assignee').toText], ['assignee', 'Bo']);
    // One feed row per label change, as the REST feed showed them.
    assert.deepEqual(
      items.filter((i) => i.id.startsWith('labels')).map((i) => [i.action, i.fromText ?? i.toText]),
      [
        ['label_add', 'Bug'],
        ['label_remove', 'Old'],
      ],
    );
    // Linear's detail: a description edit carries no text.
    assert.deepEqual([find('desc').action, find('desc').toText], ['description', null]);
    // A state deleted since the change shows as removed.
    assert.equal(find('gone').fromText, 'a removed state');
    // Linear's IssueHistory carries no action: an entry logged before ids were
    // recorded, whose names could not be matched, describes no change and is left
    // out; the entry logged when the issue was created is its creation.
    assert.equal(
      items.find((i) => i.id === 'unmatched'),
      undefined,
    );
    assert.equal(find('created').action, 'created');
  });

  it('labels only the entry logged at the issue creation as created', () => {
    const rows = [history('unmatched', 4), history('created', 2)];
    const items = (opts: Parameters<typeof buildFeed>[3]) =>
      buildFeed([], rows, ISSUE, opts).map((e) => [e.item.id, e.item.action]);
    // The creation entry, all history loaded.
    assert.deepEqual(items({ issueCreatedAt: at(2) }), [['created', 'created']]);
    // Older history not loaded: no entry is the creation.
    assert.deepEqual(items({ issueCreatedAt: at(2), historyHasMore: true }), []);
    // A name-only entry is never labelled created, even when it is the oldest loaded.
    assert.deepEqual(
      buildFeed([], [history('unmatched', 4)], ISSUE, { issueCreatedAt: at(2) }),
      [],
    );
  });

  it('cuts the feed where a stream has more to load', () => {
    const comments = [comment('c10', 10), comment('c5', 5)];
    const entries = [
      history('h9', 9, { toTitle: 'b', fromTitle: 'a' }),
      history('h2', 2, { toTitle: 'c', fromTitle: 'b' }),
    ];
    const ids = (opts: Parameters<typeof buildFeed>[3]) =>
      buildFeed(comments, entries, ISSUE, opts).map((e) => e.item.id);
    // Everything loaded: nothing is cut.
    assert.deepEqual(ids({}), ['c10', 'h9', 'c5', 'h2']);
    // Older comments exist: history older than the oldest loaded comment waits.
    assert.deepEqual(ids({ commentsHasMore: true }), ['c10', 'h9', 'c5']);
    // Both have more: cut at the newer of the two oldest loaded entries.
    assert.deepEqual(ids({ commentsHasMore: true, historyHasMore: true }), ['c10', 'h9', 'c5']);
    // Older history exists: nothing loaded is older than the oldest loaded history.
    assert.deepEqual(ids({ historyHasMore: true }), ['c10', 'h9', 'c5', 'h2']);
  });

  it('names a removed actor instead of the system', () => {
    const feed = buildFeed(
      [comment('c1', 9, { user: null })],
      [
        history('gone', 8, { actorId: 'u9', actor: null, toTitle: 'b', fromTitle: 'a' }),
        history('system', 7, { actorId: null, actor: null, archived: true }),
      ],
      ISSUE,
    );
    const names = Object.fromEntries(feed.map((e) => [e.item.id, e.item.actorName]));
    assert.deepEqual(names, { c1: 'a removed user', gone: 'a removed user', system: null });
  });
});
