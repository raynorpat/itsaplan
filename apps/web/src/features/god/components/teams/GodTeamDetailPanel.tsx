'use client';

import { Users, X } from 'lucide-react';
import type { InstanceTeamDetail } from '@/lib/api';
import { formatDate, formatDateTime } from '@/utils/dates';
import { useExitOnEscape } from '@/hooks/useExitOnEscape';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePermissionCatalogQuery } from '@/services/roles.service';
import { useInstanceTeamQuery } from '../../services/god.service';
import { compactCount } from '../../utils/numbers';
import GodTeamMemberCard from './GodTeamMemberCard';

// One number from the team, with a quiet label under it. The counts read as a
// grid so the size of a team is one glance rather than a list of sentences.
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2.5" title={`${label}: ${value}`}>
      <div className="text-lg font-semibold tabular-nums">{compactCount(value)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// The counts of a team, in the order they matter: the work first, then what is
// configured around it.
function stats(team: InstanceTeamDetail): { label: string; value: number }[] {
  return [
    { label: 'Issues', value: team.issueCount },
    { label: 'Archived issues', value: team.archivedIssueCount },
    { label: 'Projects', value: team.projectCount },
    { label: 'Members', value: team.memberCount },
    { label: 'Views', value: team.viewCount },
    { label: 'AI agents', value: team.agentCount },
    { label: 'Skills', value: team.skillCount },
    { label: 'Tools', value: team.toolCount },
    { label: 'Integrations', value: team.integrationCount },
  ];
}

// One team in a right-hand side panel (the same surface the user directory uses):
// what the team holds, and every member with the permissions their membership
// resolves to. Escape or a backdrop click closes it.
export default function GodTeamDetailPanel({
  teamId,
  onClose,
}: {
  teamId: string;
  onClose: () => void;
}) {
  const teamQuery = useInstanceTeamQuery(teamId);
  const catalogQuery = usePermissionCatalogQuery();
  const team = teamQuery.data;

  useExitOnEscape(onClose);

  return (
    <div
      className="fixed inset-0 z-40 flex bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="ml-auto flex h-full w-full flex-col border-l bg-card sm:w-[680px] sm:max-w-[92vw]">
        <div className="flex shrink-0 items-start justify-between gap-3 bg-muted/30 px-6 pt-5 pb-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                {team?.key ?? '…'}
              </span>
              <h2 className="truncate text-base font-semibold">{team ? team.name : 'Loading…'}</h2>
            </div>
            {team?.description && (
              <p className="line-clamp-2 text-xs text-muted-foreground">{team.description}</p>
            )}
            {team && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <Badge
                  variant={team.mcpEnabled ? 'secondary' : 'outline'}
                  className="px-1.5 py-0 text-[10px] font-medium"
                >
                  MCP {team.mcpEnabled ? 'enabled' : 'off'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  created {formatDate(team.createdAt)}
                </span>
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose} title="Close">
            <X />
          </Button>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto px-6 py-6">
          {!team ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <section className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Last activity:{' '}
                  {team.lastActivityAt ? formatDateTime(team.lastActivityAt) : 'none yet'}
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {stats(team).map((s) => (
                    <Stat key={s.label} label={s.label} value={s.value} />
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-medium">Members</h3>
                  {team.members.length > 0 && (
                    <span className="text-xs text-muted-foreground">{team.members.length}</span>
                  )}
                </div>
                {team.members.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-lg bg-muted/30 px-6 py-10 text-center">
                    <Users className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">No members</p>
                    <p className="max-w-[36ch] text-xs text-muted-foreground">
                      Nobody can reach this team until someone is invited to it.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {team.members.map((m) => (
                      <GodTeamMemberCard key={m.userId} member={m} catalog={catalogQuery.data} />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
