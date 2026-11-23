import SidebarConfigNav from '@/components/layout/SidebarConfigNav';
import SidebarWorkNav from '@/components/layout/SidebarWorkNav';
import SidebarWorkspaceNav from '@/components/layout/SidebarWorkspaceNav';

// The main sidebar body: the workspace group (Projects, above the teams), the
// team's work navigation, then the Configuration group.
export default function SidebarMainNav({ teamKey }: { teamKey: string | null }) {
  return (
    <>
      <SidebarWorkspaceNav />
      <SidebarWorkNav teamKey={teamKey} />
      <SidebarConfigNav teamKey={teamKey} />
    </>
  );
}
