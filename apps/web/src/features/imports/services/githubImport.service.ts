import { graphql, gqlRequest } from '@/lib/graphql';

// Linear's GitHub Import App connection: GitHub returns to the callback page with an
// OAuth code and the installation id, which the API confirms and stores.

const ConnectGithubImport = graphql(`
  mutation ConnectGithubImport($code: String!, $installationId: String!) {
    integrationGithubImportConnect(code: $code, installationId: $installationId) {
      success
    }
  }
`);

export async function connectGithubImport(code: string, installationId: string): Promise<void> {
  await gqlRequest(ConnectGithubImport, { code, installationId });
}
