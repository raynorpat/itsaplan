import { resolveIssueId } from '../resolve';
import type { McpTool } from '../types';
import { object, str } from './schema';

// Comment tools: list an issue's comments, add one.

interface CommentNode {
  id: string;
  body: string;
  createdAt: string;
  url: string;
  user: { name: string } | null;
  parent: { id: string } | null;
}

const COMMENT_FIELDS = 'id body createdAt url user { name } parent { id }';

const toComment = (c: CommentNode) => ({
  id: c.id,
  body: c.body,
  user: c.user?.name ?? null,
  createdAt: c.createdAt,
  parentId: c.parent?.id ?? null,
  url: c.url,
});

const listComments: McpTool = {
  name: 'list_comments',
  description: "List an issue's comments, oldest first; a reply carries its parentId.",
  readOnly: true,
  inputSchema: object({ issueId: str('Issue identifier ("ENG-42") or id') }, ['issueId']),
  async run(gql, args) {
    const data = await gql<{ issue: { comments: { nodes: CommentNode[] } } }>(
      `query($id: String!) { issue(id: $id) { comments(first: 250) { nodes { ${COMMENT_FIELDS} } } } }`,
      { id: String(args.issueId) },
    );
    const comments = [...data.issue.comments.nodes].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    return { comments: comments.map(toComment) };
  },
};

const createComment: McpTool = {
  name: 'create_comment',
  description: 'Add a Markdown comment to an issue, or a reply to one of its comments.',
  readOnly: false,
  inputSchema: object(
    {
      issueId: str('Issue identifier ("ENG-42") or id'),
      body: str('Markdown text'),
      parentId: str('Comment id to reply to'),
    },
    ['issueId', 'body'],
  ),
  async run(gql, args) {
    const issueId = await resolveIssueId(gql, String(args.issueId));
    const input: Record<string, unknown> = { issueId, body: String(args.body) };
    if (args.parentId) input.parentId = String(args.parentId);
    const data = await gql<{ commentCreate: { comment: CommentNode } }>(
      `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { comment { ${COMMENT_FIELDS} } } }`,
      { input },
    );
    return toComment(data.commentCreate.comment);
  },
};

export const commentTools: McpTool[] = [listComments, createComment];
