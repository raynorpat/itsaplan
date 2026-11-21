import { z } from 'zod';

const date = z.iso.date().describe('Date in YYYY-MM-DD format.');

export const issueQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Case-insensitive text search in the issue identifier, title, and description.'),
  stateId: z.string().uuid().optional().describe('Exact workflow state (column) id from get_team.'),
  typeId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe('Exact issue type id from get_team, or null for issues without a type.'),
  projectId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe('Exact project id from list_projects, or null for issues without an project.'),
  assigneeUserId: z
    .string()
    .nullable()
    .optional()
    .describe('Exact member user id from get_team, or null for unassigned issues.'),
  delegateUserId: z
    .string()
    .nullable()
    .optional()
    .describe('Exact agent user id from get_team, or null for issues without a delegate.'),
  priority: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe('Exact priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low.'),
  labelIds: z
    .array(z.string().uuid())
    .min(1)
    .optional()
    .describe('Label ids from get_team. An issue must contain every supplied label.'),
  dueFrom: date.optional().describe('Inclusive earliest due date in YYYY-MM-DD format.'),
  dueTo: date.optional().describe('Inclusive latest due date in YYYY-MM-DD format.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Maximum number of issues to return, from 1 to 200.'),
});

export type IssueQuery = z.infer<typeof issueQuerySchema>;
