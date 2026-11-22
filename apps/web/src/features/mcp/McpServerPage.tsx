'use client';

import SectionPageView from '@/components/common/page/SectionPageView';
import McpConnectionGuide from './components/McpConnectionGuide';

// How to connect an MCP client. Access is by API key: a client reaches every team
// and issue its key's user can see.
export default function McpServerPage() {
  return (
    <SectionPageView
      title="MCP Server"
      description="Let AI agents work with this team over the Model Context Protocol: every issue and board action they can reach with your access."
    >
      <McpConnectionGuide />
    </SectionPageView>
  );
}
