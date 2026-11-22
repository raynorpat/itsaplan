// Which comment controls the viewer gets, following the API's rules
// (comments/store.ts): only the author edits a comment; the author or a team
// manager deletes it; anyone who can see the thread resolves it, and only a root
// comment is resolved. The API stays the authority; these only hide controls that
// would be refused.

interface CommentLike {
  actorUserId: string | null;
  parentId: string | null;
}

export function canEditComment(viewerId: string | null, comment: CommentLike): boolean {
  return viewerId != null && comment.actorUserId === viewerId;
}

export function canDeleteComment(
  viewerId: string | null,
  comment: CommentLike,
  canManageTeam: boolean,
): boolean {
  if (viewerId == null) return false;
  return comment.actorUserId === viewerId || canManageTeam;
}

export function canResolveThread(viewerId: string | null, comment: CommentLike): boolean {
  return viewerId != null && comment.parentId == null;
}
