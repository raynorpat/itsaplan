import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addFeedbackWithSource } from '@/services/feedbackCreate';

// Adding feedback is two requests (the source attachment, then the feedback). The
// feedback is created with an id the client chose, so after an uncertain failure the
// client can tell whether it was saved before removing the attachment.

function steps(opts: { createFails?: boolean; saved?: boolean; cleanupFails?: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      createAttachment: async () => {
        calls.push('attach');
        return 'att-1';
      },
      createNeed: async (id: string, attachmentId: string) => {
        calls.push(`need:${attachmentId}`);
        assert.match(id, /^[0-9a-f-]{36}$/);
        if (opts.createFails) throw new Error('network');
      },
      needExists: async () => {
        calls.push('read');
        return opts.saved ?? false;
      },
      deleteAttachment: async (id: string) => {
        calls.push(`delete:${id}`);
        if (opts.cleanupFails) throw new Error('cleanup failed');
      },
    },
  };
}

describe('addFeedbackWithSource', () => {
  it('creates the attachment, then the feedback with a client id', async () => {
    const { calls, deps } = steps({});
    await addFeedbackWithSource(deps);
    assert.deepEqual(calls, ['attach', 'need:att-1']);
  });

  it('keeps the attachment when the feedback was saved despite the error', async () => {
    const { calls, deps } = steps({ createFails: true, saved: true });
    await addFeedbackWithSource(deps);
    assert.deepEqual(calls, ['attach', 'need:att-1', 'read']);
  });

  it('removes the attachment when the feedback was not saved, and fails', async () => {
    const { calls, deps } = steps({ createFails: true, saved: false });
    await assert.rejects(addFeedbackWithSource(deps), /network/);
    assert.deepEqual(calls, ['attach', 'need:att-1', 'read', 'delete:att-1']);
  });

  it('reports the first error when the cleanup also fails', async () => {
    const { deps } = steps({ createFails: true, saved: false, cleanupFails: true });
    await assert.rejects(addFeedbackWithSource(deps), /network/);
  });
});
