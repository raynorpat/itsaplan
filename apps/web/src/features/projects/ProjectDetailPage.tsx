'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useShell } from '@/context/shellContext';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { projectPath, type ProjectTab } from '@/utils/paths';
import { qk } from '@/services/queryKeys';
import { useProjectQuery } from '@/services/projects.service';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ProjectHeader from './components/detail/ProjectHeader';
import ProjectIssuesBoard from './components/detail/ProjectIssuesBoard';
import ProjectDocuments from './components/detail/ProjectDocuments';
import ProjectOverview from './components/detail/ProjectOverview';
import ProjectUpdates from './components/detail/ProjectUpdates';

// One project: a header, then Linear's tabs: Overview, Updates, Issues (the work
// items board over its linked issues) and Documents. Each tab is its own route, so
// the open tab survives a reload; the route that mounts this page passes it.
export default function ProjectDetailPage({ tab = 'overview' }: { tab?: ProjectTab }) {
  const { team } = useShell();
  const router = useRouter();
  const params = useParams();
  const raw = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const projectId = raw ?? null;

  const query = useProjectQuery(projectId);
  const teamKey = team?.team.key ?? '';

  // Refresh the project (progress, health), its activity and its updates so others'
  // changes show.
  const id = projectId ?? '';
  useLiveRefresh({
    targets: [qk.project(id), qk.projectActivity(id), qk.projectUpdates(id)],
    enabled: projectId != null && !!teamKey,
  });

  // The page shows the issues of one of the project's teams: the team its URL
  // names, else the project's first team.
  const project = query.data;
  const firstTeamKey = project?.teams[0]?.key ?? null;
  const onProjectTeam = project?.teams.some((t) => t.key === teamKey) ?? true;
  useEffect(() => {
    if (!onProjectTeam && firstTeamKey && projectId)
      router.replace(projectPath(firstTeamKey, projectId, tab));
  }, [onProjectTeam, firstTeamKey, projectId, router, tab]);

  if (!team || projectId == null) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!project ? (
        <p className="px-6 py-8 text-sm text-muted-foreground">
          {query.isLoading ? 'Loading…' : 'Project not found.'}
        </p>
      ) : (
        <>
          <ProjectHeader project={project} team={team} />
          <Tabs
            value={tab}
            onValueChange={(value) =>
              router.push(projectPath(teamKey, project.id, value as ProjectTab))
            }
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="px-6 pt-3">
              <TabsList variant="line">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="updates">Updates</TabsTrigger>
                <TabsTrigger value="issues">Issues</TabsTrigger>
                <TabsTrigger value="documents">Documents</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="overview" className="mt-0 flex-1 overflow-y-auto">
              <ProjectOverview project={project} team={team} />
            </TabsContent>
            <TabsContent value="updates" className="mt-0 flex-1 overflow-y-auto">
              <ProjectUpdates project={project} team={team} />
            </TabsContent>
            <TabsContent value="issues" className="mt-0 flex min-h-0 flex-1 flex-col">
              <ProjectIssuesBoard projectId={project.id} />
            </TabsContent>
            <TabsContent value="documents" className="mt-0 flex-1 overflow-y-auto">
              <ProjectDocuments project={project} team={team} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
