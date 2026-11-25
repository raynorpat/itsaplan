// How long the file URL stays valid after the click: revoking it at once can cancel the
// download in Safari and Firefox.
export const REVOKE_AFTER_MS = 1000;

// Saves a file through a temporary link (the browser's download).
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

export function downloadText(
  fileName: string,
  text: string,
  type = 'text/csv;charset=utf-8',
): void {
  downloadBlob(fileName, new Blob([text], { type }));
}
