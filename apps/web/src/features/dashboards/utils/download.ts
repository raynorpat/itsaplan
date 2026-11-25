// Saves text as a file through a temporary link (the browser's download).
export function downloadText(
  fileName: string,
  text: string,
  type = 'text/csv;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// A file name from a widget title: letters, digits and dashes only.
export const csvFileName = (title: string): string =>
  `${
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'widget'
  }.csv`;
