// A team's two-letter badge in the sidebar.
export default function SidebarTeamBadge({ teamKey }: { teamKey: string }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-sidebar-accent text-[10px] font-semibold">
      {teamKey.slice(0, 2)}
    </span>
  );
}
