import { useQuery } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';

const SecuritySettingsQuery = graphql(`
  query SecuritySettings {
    organization {
      id
      securitySettings
    }
  }
`);

// The organization's minimum-role settings (Linear's securitySettings), read once
// and shared by the controls they gate.
export function useSecuritySettings(): Record<string, unknown> | undefined {
  return useQuery({
    queryKey: ['securitySettings'],
    queryFn: async () => {
      const { organization } = await gqlRequest(SecuritySettingsQuery);
      return (organization.securitySettings ?? {}) as Record<string, unknown>;
    },
  }).data;
}

// One minimum-role setting by name, or undefined while loading or when unset.
export function useMinimumRole(key: string): string | undefined {
  const value = useSecuritySettings()?.[key];
  return typeof value === 'string' ? value : undefined;
}
