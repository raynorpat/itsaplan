'use client';

import SectionPageView from '@/components/common/page/SectionPageView';
import McpConnectionGuide from './components/McpConnectionGuide';

// How to connect an MCP client: by signing in through the browser (OAuth) or with an
// API key. A client reaches what the signed-in person can see, within what they allowed.
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
