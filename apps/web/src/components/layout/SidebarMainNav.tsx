import SidebarAiTeamNav from '@/components/layout/SidebarAiTeamNav';
import SidebarConfigNav from '@/components/layout/SidebarConfigNav';
import SidebarWorkNav from '@/components/layout/SidebarWorkNav';

// The main sidebar body: the work navigation, the AI Team group, then the
// Configuration group.
export default function SidebarMainNav({
  teamKey,
  teamId,
}: {
  teamKey: string | null;
  teamId: string | null;
}) {
  return (
    <>
      <SidebarWorkNav teamKey={teamKey} teamId={teamId} />
      <SidebarAiTeamNav teamKey={teamKey} />
      <SidebarConfigNav teamKey={teamKey} />
    </>
  );
}
