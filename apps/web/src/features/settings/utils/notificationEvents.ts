import type { EmailCategories } from '@/features/settings/utils/notificationPreferences';

// The Linear notification categories this instance sends by email, with a display
// label.
export const NOTIFICATION_CATEGORIES: { key: keyof EmailCategories; label: string }[] = [
  { key: 'assignments', label: 'Assigned to an issue' },
  { key: 'mentions', label: 'Mentioned in a comment' },
  { key: 'commentsAndReplies', label: 'Comments and replies on issues you follow' },
  { key: 'statusChanges', label: 'Status changes on issues you follow' },
];

export function categoriesEqual(a: EmailCategories, b: EmailCategories): boolean {
  return NOTIFICATION_CATEGORIES.every(({ key }) => a[key] === b[key]);
}
