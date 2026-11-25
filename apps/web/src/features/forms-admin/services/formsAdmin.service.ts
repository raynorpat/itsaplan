'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchProjectsPage } from '@/services/projects.service';
import {
  templateDataFromEditor,
  type FormEditorState,
  type FormSettings,
} from '../utils/formEditor';

// Forms: the template through GraphQL (templateCreate / templateUpdate / template),
// the publishing settings through /api/auth/instance/forms* (owners and admins), since
// Linear's schema has no place for them.

export interface FormDto extends FormSettings {
  templateId: string;
  name: string;
  teamId: string;
  teamName: string;
  updatedAt: string;
}

// The fields of a portal board the board picker needs (GET /instance/portal/boards).
export interface FormBoardOption {
  id: string;
  name: string;
  teamId: string | null;
  projectId: string | null;
}

const formsKey = ['forms'] as const;

export function useFormsQuery(enabled: boolean) {
  return useQuery({
    queryKey: formsKey,
    queryFn: async () => (await instanceFetch<{ forms: FormDto[] }>('/instance/forms')).forms,
    enabled,
  });
}

const TemplateQuery = graphql(`
  query FormTemplate($id: String!) {
    template(id: $id) {
      id
      name
      templateData
      team {
        id
      }
    }
  }
`);

export function useFormTemplate(templateId: string | null) {
  return useQuery({
    queryKey: [...formsKey, 'template', templateId],
    queryFn: async () => (await gqlRequest(TemplateQuery, { id: templateId! })).template,
    enabled: templateId != null,
  });
}

const CreateTemplate = graphql(`
  mutation FormTemplateCreate($input: TemplateCreateInput!) {
    templateCreate(input: $input) {
      template {
        id
      }
    }
  }
`);

const UpdateTemplate = graphql(`
  mutation FormTemplateUpdate($id: String!, $input: TemplateUpdateInput!) {
    templateUpdate(id: $id, input: $input) {
      success
    }
  }
`);

// Saves the template, then its publishing settings (replaced whole). `existing` is
// the stored template data of an edited form, so its title and description stay.
export function useSaveForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      templateId,
      form,
      existing,
    }: {
      templateId: string | null;
      form: FormEditorState;
      existing: unknown;
    }) => {
      const templateData = templateDataFromEditor(form, existing);
      const name = form.name.trim();
      let id = templateId;
      if (id) {
        await gqlRequest(UpdateTemplate, { id, input: { name, templateData } });
      } else {
        const created = await gqlRequest(CreateTemplate, {
          input: { name, type: 'issue', teamId: form.teamId, templateData },
        });
        id = created.templateCreate.template.id;
      }
      await instanceFetch('/instance/forms/settings', {
        method: 'POST',
        body: {
          templateId: id,
          slug: form.slug,
          intro: form.intro.trim(),
          linkEnabled: form.linkEnabled,
          boardIds: form.boardIds,
        },
      });
      return id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: formsKey }),
  });
}

export function useDeleteForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) =>
      instanceFetch('/instance/forms/delete', { method: 'POST', body: { templateId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: formsKey }),
  });
}

// The portal boards, for the board picker (the portal settings' own list).
export function useFormBoardOptions(enabled: boolean) {
  return useQuery({
    queryKey: qk.portalBoards,
    queryFn: async () =>
      (await instanceFetch<{ boards: FormBoardOption[] }>('/instance/portal/boards')).boards,
    enabled,
  });
}

// project id → its team ids, for the project boards a form may be placed on.
export function useProjectTeams(enabled: boolean) {
  return useQuery({
    queryKey: [...formsKey, 'projectTeams'],
    queryFn: async () => {
      const projects = (await fetchProjectsPage({}, 250)).items;
      return Object.fromEntries(projects.map((p) => [p.id, p.teams.map((t) => t.id)]));
    },
    enabled,
  });
}
