import SidebarAiTeamNav from '@/components/layout/SidebarAiTeamNav';
import SidebarConfigNav from '@/components/layout/SidebarConfigNav';
import SidebarWorkNav from '@/components/layout/SidebarWorkNav';
import SidebarWorkspaceNav from '@/components/layout/SidebarWorkspaceNav';

// The main sidebar body: the workspace group (Projects, above the teams), the
// team's work navigation, the AI Team group, then the Configuration group.
export default function SidebarMainNav({
  teamKey,
  teamId,
}: {
  teamKey: string | null;
  teamId: string | null;
}) {
  return (
    <>
      <SidebarWorkspaceNav />
      <SidebarWorkNav teamKey={teamKey} teamId={teamId} />
      <SidebarAiTeamNav teamKey={teamKey} />
      <SidebarConfigNav teamKey={teamKey} />
    </>
  );
}
