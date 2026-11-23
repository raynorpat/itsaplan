// Email on or off per Linear notification category.
export interface EmailCategories {
  assignments: boolean;
  mentions: boolean;
  commentsAndReplies: boolean;
  statusChanges: boolean;
}

// The signed-in user's email notification preferences for the whole workspace, per
// Linear notification category. Email is sent to the account address.
export interface NotificationPreferences {
  emailCategories: EmailCategories;
}

// Linear's UserSettings.notificationCategoryPreferences holds a channel set per
// category. The page edits the email channel of the four categories this instance
// sends; the API stores only those.

type CategoryChannels = Record<keyof EmailCategories, { email: boolean }>;

export function toNotificationPreferences(categories: CategoryChannels): NotificationPreferences {
  return {
    emailCategories: {
      assignments: categories.assignments.email,
      mentions: categories.mentions.email,
      commentsAndReplies: categories.commentsAndReplies.email,
      statusChanges: categories.statusChanges.email,
    },
  };
}

export function toCategoryPreferencesInput({
  emailCategories: e,
}: NotificationPreferences): CategoryChannels {
  return {
    assignments: { email: e.assignments },
    mentions: { email: e.mentions },
    commentsAndReplies: { email: e.commentsAndReplies },
    statusChanges: { email: e.statusChanges },
  };
}
