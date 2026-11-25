'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import SettingsCard from '@/components/common/page/SettingsCard';
import {
  useDeleteAiSettings,
  useSaveAiSettings,
  useTestAiSettings,
  type AiSettings,
} from '../services/aiSettings.service';
import { aiFormErrors, normalizeBaseUrl } from '../utils/aiSettings';

// The endpoint's address, model and API key. The stored key is never shown; leaving
// the key empty keeps it. Test sends one short request with the saved settings.
export default function AiSettingsForm({ settings }: { settings: AiSettings }) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? '');
  const [model, setModel] = useState(settings.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const save = useSaveAiSettings();
  const remove = useDeleteAiSettings();
  const test = useTestAiSettings();

  const errors = aiFormErrors({ baseUrl, model });
  const keyMissing = !settings.hasKey && !apiKey.trim();
  const shown = submitted ? errors : {};

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0 || keyMissing) return;
    save.mutate(
      { baseUrl: normalizeBaseUrl(baseUrl), model: model.trim(), apiKey: apiKey.trim() },
      {
        onSuccess: () => {
          setApiKey('');
          setSubmitted(false);
          toast.success('AI endpoint saved');
        },
      },
    );
  }

  function onTest() {
    test.mutate(
      {},
      {
        onSuccess: (result) =>
          result.ok
            ? toast.success('The endpoint answered')
            : toast.error(result.error ?? 'The endpoint did not answer'),
      },
    );
  }

  function onRemove() {
    if (!window.confirm('Remove the AI endpoint? Summaries go back to a list of the changes.'))
      return;
    remove.mutate(
      {},
      {
        onSuccess: () => {
          setBaseUrl('');
          setModel('');
          setApiKey('');
          toast.success('AI endpoint removed');
        },
      },
    );
  }

  return (
    <SettingsCard className="p-4">
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field data-invalid={shown.baseUrl ? true : undefined}>
            <FieldLabel htmlFor="ai-base-url">Base URL</FieldLabel>
            <Input
              id="ai-base-url"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            {shown.baseUrl ? (
              <FieldError>{shown.baseUrl}</FieldError>
            ) : (
              <FieldDescription>
                The address before <code>/chat/completions</code>.
              </FieldDescription>
            )}
          </Field>
          <Field data-invalid={shown.model ? true : undefined}>
            <FieldLabel htmlFor="ai-model">Model</FieldLabel>
            <Input
              id="ai-model"
              placeholder="gpt-4o-mini"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            {shown.model && <FieldError>{shown.model}</FieldError>}
          </Field>
          <Field data-invalid={submitted && keyMissing ? true : undefined}>
            <FieldLabel htmlFor="ai-api-key">API key</FieldLabel>
            <Input
              id="ai-api-key"
              type="password"
              autoComplete="off"
              placeholder={settings.hasKey ? 'Saved — leave empty to keep it' : ''}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {submitted && keyMissing ? (
              <FieldError>Enter the API key</FieldError>
            ) : (
              <FieldDescription>Stored encrypted and never shown again.</FieldDescription>
            )}
          </Field>
          <Field orientation="horizontal">
            <Button type="submit" disabled={save.isPending} className="w-fit">
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            {settings.hasKey && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={test.isPending}
                  className="w-fit"
                  onClick={onTest}
                >
                  {test.isPending ? 'Testing…' : 'Test'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={remove.isPending}
                  className="w-fit text-destructive"
                  onClick={onRemove}
                >
                  Remove
                </Button>
              </>
            )}
          </Field>
        </FieldGroup>
      </form>
    </SettingsCard>
  );
}
