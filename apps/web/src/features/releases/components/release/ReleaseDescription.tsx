'use client';

import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { useReleaseWrites } from '@/services/releases.service';
import ReleaseSection from '../ReleaseSection';

// The release's description, saved on blur; read only without edit rights.
export default function ReleaseDescription({
  releaseId,
  description,
  canEdit,
}: {
  releaseId: string;
  description: string | null;
  canEdit: boolean;
}) {
  const [value, setValue] = useState(description ?? '');
  const { update } = useReleaseWrites();
  if (!canEdit && !description) return null;
  return (
    <ReleaseSection title="Description">
      <div className="px-6 py-3">
        {canEdit ? (
          <Textarea
            aria-label="Description"
            value={value}
            placeholder="What this release is about…"
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              const next = value.trim() || null;
              if (next !== (description ?? null))
                update.mutate({ id: releaseId, input: { description: next } });
            }}
          />
        ) : (
          <p className="text-sm whitespace-pre-wrap">{description}</p>
        )}
      </div>
    </ReleaseSection>
  );
}
