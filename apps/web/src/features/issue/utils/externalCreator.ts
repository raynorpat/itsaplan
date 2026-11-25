// The line naming the person outside the workspace who created an issue, from the
// subtitles of the issue's feedback sources: "Form: <name>" for a form submission,
// "Portal" for a portal suggestion.
export function externalCreatorText(name: string, subtitles: string[]): string {
  const form = subtitles.find((s) => s.startsWith('Form: '));
  if (form) return `Submitted by ${name} through the ${form.slice('Form: '.length)} form`;
  if (subtitles.includes('Portal')) return `Suggested by ${name} on the portal`;
  return `Submitted by ${name}`;
}
