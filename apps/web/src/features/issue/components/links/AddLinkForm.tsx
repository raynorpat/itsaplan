import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Adds a link to the issue: a URL and an optional title (the URL is the title when
// left empty, as Linear does). The API refuses anything but an http(s) URL.
export default function AddLinkForm({
  pending,
  onAdd,
  onCancel,
}: {
  pending: boolean;
  onAdd: (url: string, title: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onAdd(url.trim(), title.trim());
      setUrl('');
      setTitle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the link');
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mb-3 flex flex-col gap-2 rounded-md border p-3"
    >
      <Input
        autoFocus
        type="url"
        required
        placeholder="https://…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="Link URL"
      />
      <Input
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Link title"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !url.trim()}>
          Add link
        </Button>
      </div>
    </form>
  );
}
