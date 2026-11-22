'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import SettingsCard from '@/components/common/page/SettingsCard';
import type { OrganizationSettings } from '@/lib/api';
import { useUpdateOrganization } from '../services/organization.service';

// The file types people may attach, one per line: a full type (application/pdf) or a
// wildcard (image/*). Empty accepts any type.
export default function WorkspaceUploadTypes({ org }: { org: OrganizationSettings }) {
  const [text, setText] = useState(org.allowedFileUploadContentTypes.join('\n'));
  const update = useUpdateOrganization();
  const types = text
    .split(/[\n,]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  return (
    <SettingsCard className="p-4">
      <Field>
        <FieldLabel htmlFor="org-upload-types">Allowed file types</FieldLabel>
        <Textarea
          id="org-upload-types"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <FieldDescription>One per line, such as image/* or application/pdf.</FieldDescription>
        <Button
          className="mt-2 w-fit"
          disabled={update.isPending}
          onClick={() => update.mutate({ allowedFileUploadContentTypes: types })}
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </Field>
    </SettingsCard>
  );
}
