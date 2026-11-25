import { useState, type FormEvent } from 'react';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  usePipelineSettingsWrites,
  type PipelineInput,
  type PipelineSettings,
} from '../services/releasesSettings.service';
import { parsePathPatterns } from '../utils/pipelineForm';
import PipelineTypeField from './PipelineTypeField';
import PipelineSwitchField from './PipelineSwitchField';

// Creates a pipeline for the team, or edits one: name, type, production, rollover,
// automatic release notes and path patterns.
export default function PipelineDialog({
  teamId,
  pipeline,
  onClose,
}: {
  teamId: string;
  pipeline: PipelineSettings | null;
  onClose: () => void;
}) {
  const { createPipeline, updatePipeline } = usePipelineSettingsWrites();
  const [form, setForm] = useState<PipelineInput>({
    name: pipeline?.name ?? '',
    type: pipeline?.type ?? 'continuous',
    isProduction: pipeline?.isProduction ?? true,
    rolloverIssuesOnCompletion: pipeline?.rolloverIssuesOnCompletion ?? true,
    autoGenerateReleaseNotesOnCompletion: pipeline?.autoGenerateReleaseNotesOnCompletion ?? false,
    includePathPatterns: pipeline?.includePathPatterns ?? [],
  });
  const [patterns, setPatterns] = useState((pipeline?.includePathPatterns ?? []).join('\n'));
  const set = (patch: Partial<PipelineInput>) => setForm((f) => ({ ...f, ...patch }));
  const pending = createPipeline.isPending || updatePipeline.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input = {
      ...form,
      name: form.name.trim(),
      includePathPatterns: parsePathPatterns(patterns),
    };
    const done = { onSuccess: onClose };
    if (pipeline) updatePipeline.mutate({ id: pipeline.id, input }, done);
    else createPipeline.mutate({ ...input, teamIds: [teamId] }, done);
  };

  return (
    <Modal title={pipeline ? 'Edit pipeline' : 'New pipeline'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pipeline-name">Name</Label>
          <Input
            id="pipeline-name"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Production"
            autoFocus
          />
        </div>
        <PipelineTypeField value={form.type} onChange={(type) => set({ type })} />
        <PipelineSwitchField
          id="pipeline-production"
          label="Production"
          hint="People who asked for an issue hear that it shipped only from production releases."
          checked={form.isProduction}
          onChange={(isProduction) => set({ isProduction })}
        />
        {form.type === 'scheduled' && (
          <PipelineSwitchField
            id="pipeline-rollover"
            label="Move unfinished issues on"
            hint="Completing a release moves its unfinished issues to the next planned release."
            checked={form.rolloverIssuesOnCompletion}
            onChange={(rolloverIssuesOnCompletion) => set({ rolloverIssuesOnCompletion })}
          />
        )}
        <PipelineSwitchField
          id="pipeline-notes"
          label="Draft release notes on completion"
          hint="A completed release gets notes listing its completed issues, grouped by label."
          checked={form.autoGenerateReleaseNotesOnCompletion}
          onChange={(v) => set({ autoGenerateReleaseNotesOnCompletion: v })}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pipeline-paths">Path patterns</Label>
          <Textarea
            id="pipeline-paths"
            value={patterns}
            onChange={(e) => setPatterns(e.target.value)}
            placeholder={'apps/web/**\npackages/ui/**'}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            One per line. Stored for CI scripts that filter commits by path.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !form.name.trim()}>
            {pipeline ? 'Save' : 'Create pipeline'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
