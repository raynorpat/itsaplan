'use client';

import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import SectionPageView from '@/components/common/page/SectionPageView';
import McpStatusRow from './components/McpStatusRow';
import McpConnectionGuide from './components/McpConnectionGuide';

export default function McpServerPage() {
  const { team } = useShell();
  const { isOwner } = usePermissions();

  return (
    <SectionPageView
      title="MCP Server"
      description="Let AI agents work with this team over the Model Context Protocol: every issue and board action they can reach with your access."
    >
      <div className="space-y-10">
        <McpStatusRow
          teamKey={team?.team.key ?? ''}
          enabled={team?.team.mcpEnabled ?? false}
          isLoading={!team}
          canManage={isOwner}
        />
        <McpConnectionGuide />
      </div>
    </SectionPageView>
  );
}
