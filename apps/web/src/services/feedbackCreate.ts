// Adding feedback is two requests: the requester's source attachment (instance
// plugin), then Linear's customerNeedCreate. The feedback gets an id chosen here, so
// after a failed second request the client can check whether it was saved anyway (a
// lost response) before removing the attachment; a removal that fails leaves an
// attachment no guest can see and no member list shows outside its feedback.
export async function addFeedbackWithSource(deps: {
  createAttachment: () => Promise<string>;
  createNeed: (id: string, attachmentId: string) => Promise<unknown>;
  needExists: (id: string) => Promise<boolean>;
  deleteAttachment: (attachmentId: string) => Promise<unknown>;
}): Promise<void> {
  const attachmentId = await deps.createAttachment();
  const id = crypto.randomUUID();
  try {
    await deps.createNeed(id, attachmentId);
  } catch (err) {
    const saved = await deps.needExists(id).catch(() => false);
    if (saved) return;
    await deps.deleteAttachment(attachmentId).catch(() => undefined);
    throw err;
  }
}
