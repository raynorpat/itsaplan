// A file name from a widget title: letters, digits and dashes only.
export const csvFileName = (title: string): string =>
  `${
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'widget'
  }.csv`;
