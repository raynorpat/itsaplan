'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import type { AccessAction, AccessArea } from '@/hooks/usePermissions';

// The permission of the active settings section: a resource of the permission matrix,
// or a fixed answer for a section the matrix does not cover (workspace labels follow
// the organization's label-management role). Provided once per section so the shared
// CRUD controls can gate their create/edit/delete buttons without every call site
// threading it down.
type SectionPermission = { resource: AccessArea } | { allowed: boolean };

const SettingsResourceContext = createContext<SectionPermission | null>(null);

export function SettingsResourceProvider({
  resource,
  children,
}: {
  resource: AccessArea;
  children: ReactNode;
}) {
  return (
    <SettingsResourceContext.Provider value={{ resource }}>
      {children}
    </SettingsResourceContext.Provider>
  );
}

// Gates every create/edit/delete control of the section on one answer.
export function SettingsAllowedProvider({
  allowed,
  children,
}: {
  allowed: boolean;
  children: ReactNode;
}) {
  return (
    <SettingsResourceContext.Provider value={{ allowed }}>
      {children}
    </SettingsResourceContext.Provider>
  );
}

// Whether the current user may perform an action on the active section's resource.
// Allows everything when used with no provider (a CRUD control reused elsewhere
// keeps working); owners always pass. Gates UI only — the API enforces the matrix.
export function useSettingsCan(): (action: AccessAction) => boolean {
  const permission = useContext(SettingsResourceContext);
  const { can } = usePermissions();
  return (action) => {
    if (permission == null) return true;
    if ('allowed' in permission) return permission.allowed;
    return can(permission.resource, action);
  };
}
