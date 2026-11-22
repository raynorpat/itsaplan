import {
  CATEGORIES,
  getEmailCategories,
  setEmailCategories,
  type Category,
  type EmailCategories,
} from '../../notification-preferences/store';
import type { GraphQLContext } from '../context';
import { gqlError } from '../errors';
import { userById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';

// Linear's UserSettings for the viewer. Email notification preferences per category
// (notificationCategoryPreferences, email channel) are stored for the four categories
// this instance sends; every other category and channel reads false. The settings id
// is the user's id.

// Every category in Linear's NotificationCategoryPreferences (all non-null).
const LINEAR_CATEGORIES = [
  'appsAndIntegrations',
  'assignments',
  'billing',
  'commentsAndReplies',
  'customers',
  'documentChanges',
  'feed',
  'loops',
  'mentions',
  'postsAndUpdates',
  'reactions',
  'reminders',
  'reviews',
  'statusChanges',
  'subscriptions',
  'system',
  'triage',
] as const;

const channels = (email: boolean) => ({ email, desktop: false, mobile: false, slack: false });

function toUserSettings(userId: string, categories: EmailCategories) {
  const stored = categories as Record<string, boolean>;
  return {
    id: userId,
    userId,
    notificationCategoryPreferences: Object.fromEntries(
      LINEAR_CATEGORIES.map((c) => [c, channels(stored[c] ?? false)]),
    ),
    notificationChannelPreferences: channels(true),
  };
}

type Input = Record<string, unknown>;

// The categories a notificationCategoryPreferences input changes; only the email
// channel of the four stored categories may be set.
function categoryPatch(value: unknown): Partial<EmailCategories> {
  if (value == null || typeof value !== 'object')
    throw gqlError('INVALID_INPUT', 'input.notificationCategoryPreferences must be an object');
  const patch: Partial<EmailCategories> = {};
  for (const [category, prefs] of Object.entries(value as Input)) {
    const path = `input.notificationCategoryPreferences.${category}`;
    if (prefs === undefined || prefs === null) continue;
    if (!(CATEGORIES as readonly string[]).includes(category))
      throw gqlError('INVALID_INPUT', `${path} is not supported`);
    onlySupported(prefs as Input, ['email'], path);
    const email = (prefs as Input).email;
    if (email === undefined || email === null) continue;
    if (typeof email !== 'boolean')
      throw gqlError('INVALID_INPUT', `${path}.email must be a boolean`);
    patch[category as Category] = email;
  }
  return patch;
}

export const userSettingsResolvers = {
  Query: {
    userSettings: async (_: unknown, __: unknown, ctx: GraphQLContext) =>
      toUserSettings(ctx.user.id, await getEmailCategories(ctx.user.id)),
  },
  UserSettings: {
    user: (s: { userId: string }, _: unknown, ctx: GraphQLContext) =>
      userById(s.userId, ctx.user.id),
  },
  Mutation: {
    userSettingsUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Input },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['notificationCategoryPreferences'], 'input');
        // The viewer's own settings only; anyone else's are not found.
        if (id !== ctx.user.id) throw gqlError('ENTITY_NOT_FOUND', `UserSettings ${id} not found`);
        const categories =
          input.notificationCategoryPreferences === undefined
            ? await getEmailCategories(ctx.user.id)
            : await setEmailCategories(
                ctx.user.id,
                categoryPatch(input.notificationCategoryPreferences),
              );
        return {
          success: true,
          lastSyncId: lastSyncId(),
          userSettings: toUserSettings(ctx.user.id, categories),
        };
      }),
  },
};
