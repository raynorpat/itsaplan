import { templateDataFromEditor, type FormEditorState, type IssueTemplateData } from './formEditor';

// Saving a form takes two writes: the template (GraphQL) and its publishing settings
// (the instance endpoint). The settings are checked first, so a taken address or a
// board that does not fit refuses before a template exists; and the id of a template
// created by a save whose settings then failed is reported (`onCreated`), so the
// editor's retry updates that template instead of creating another.

export type SettingsBody = {
  templateId?: string;
  teamId?: string;
  slug: string;
  intro: string;
  linkEnabled: boolean;
  boardIds: string[];
  validateOnly?: boolean;
};

export interface SaveFormApi {
  validate(body: SettingsBody): Promise<void>;
  createTemplate(input: {
    name: string;
    teamId: string;
    templateData: IssueTemplateData;
  }): Promise<string>;
  updateTemplate(
    id: string,
    input: { name: string; templateData: IssueTemplateData },
  ): Promise<void>;
  saveSettings(body: SettingsBody): Promise<void>;
}

export async function saveFormSteps(
  api: SaveFormApi,
  input: {
    templateId: string | null;
    form: FormEditorState;
    existing: unknown;
    onCreated: (id: string) => void;
  },
): Promise<string> {
  const { form } = input;
  const settings = {
    slug: form.slug,
    intro: form.intro.trim(),
    linkEnabled: form.linkEnabled,
    boardIds: form.boardIds,
  };
  await api.validate({
    ...settings,
    validateOnly: true,
    ...(input.templateId ? { templateId: input.templateId } : { teamId: form.teamId }),
  });
  const templateData = templateDataFromEditor(form, input.existing);
  const name = form.name.trim();
  let id = input.templateId;
  if (id) {
    await api.updateTemplate(id, { name, templateData });
  } else {
    id = await api.createTemplate({ name, teamId: form.teamId, templateData });
    input.onCreated(id);
  }
  await api.saveSettings({ ...settings, templateId: id });
  return id;
}
