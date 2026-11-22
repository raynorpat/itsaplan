'use client';

import ItsAPlanMark from '@/components/brand/ItsAPlanMark';
import { useAppVersionQuery } from '@/services/version.service';

// The product mark at the bottom of the sidebar, with the running version under it.
// Collapses to the mark alone when the sidebar is in icon mode.
export default function SidebarBrandFooter() {
  const { data: appVersion } = useAppVersionQuery();
  const version = appVersion?.version;

  return (
    <div className="flex w-full items-center gap-2.5 px-2 pt-2 pb-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <ItsAPlanMark className="size-9 shrink-0 text-sidebar-foreground" />
      <div className="grid text-left leading-none group-data-[collapsible=icon]:hidden">
        <span className="text-base font-semibold tracking-tight text-sidebar-foreground">
          It&apos;s a Plan
        </span>
        <span className="mt-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
          {version ? `v${version}` : 'Self-hosted'}
        </span>
      </div>
    </div>
  );
}
