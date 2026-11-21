import { randomUUID } from 'node:crypto';
import { getOrCreateSetting } from '@repo/db';

// The instance has no workspace level, so Linear's Organization is one synthetic
// row per instance. Its id and creation time are created on first read and kept in
// app_setting, so every client sees the same organization.
const ORGANIZATION_KEY = 'graphql_organization';

interface StoredOrganization {
  id: string;
  createdAt: string;
}

export async function getOrganization() {
  const org = await getOrCreateSetting<StoredOrganization>(ORGANIZATION_KEY, {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  return {
    id: org.id,
    name: "It's a Plan",
    urlKey: 'itsaplan',
    createdAt: org.createdAt,
    updatedAt: org.createdAt,
    gitBranchFormat: '{issueIdentifier}-{issueTitle}',
  };
}

export const organizationResolvers = {
  Query: {
    organization: () => getOrganization(),
  },
};
