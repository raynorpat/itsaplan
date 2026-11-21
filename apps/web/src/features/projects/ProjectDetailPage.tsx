'use client';

import { useParams, useRouter } from 'next/navigation';
import { useShell } from '@/context/shellContext';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { api } from '@/lib/api';
import { projectPath, type ProjectTab } from '@/utils/paths';
import { qk } from '@/services/queryKeys';
import { useProjectQuery } from '@/services/projects.service';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ProjectHeader from './components/detail/ProjectHeader';
import ProjectIssuesBoard from './components/detail/ProjectIssuesBoard';
import ProjectOverview from './components/detail/ProjectOverview';

// One project: a header of its properties, then an Overview tab and an Issues
// tab (the work items board over its linked issues). Each tab is its own route, so
// the open tab survives a reload; the route that mounts this page passes it.
export default function ProjectDetailPage({ tab = 'overview' }: { tab?: ProjectTab }) {
  const { team } = useShell();
  const router = useRouter();
  const params = useParams();
  const raw = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const projectId = raw ?? null;

  const query = useProjectQuery(projectId);
  const teamKey = team?.team.key ?? '';

  // Poll the project's change marker: refetch the project (progress/health),
  // its feed, and the board issues when its linked issues or its own fields change.
  useLiveRefresh({
    revKey: ['rev', 'project', projectId ?? ''],
    fetchRev: () => api.getProjectRev(projectId!),
    targets: [
      qk.project(projectId ?? ''),
      qk.projectFeed(projectId ?? ''),
      qk.boardIssues(teamKey),
    ],
    intervalMs: 12000,
    enabled: projectId != null && !!teamKey,
  });

  if (!team || projectId == null) return null;

  const project = query.data;

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
                <TabsTrigger value="issues">Issues</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="overview" className="mt-0 flex-1 overflow-y-auto">
              <ProjectOverview project={project} team={team} />
            </TabsContent>
            <TabsContent value="issues" className="mt-0 flex min-h-0 flex-1 flex-col">
              <ProjectIssuesBoard projectId={project.id} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
