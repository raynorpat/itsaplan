import type { TeamDetail } from '@/lib/api';
import type { WidgetInstance } from '@/utils/dashboardWidgets';
import StatWidget from './widgets/StatWidget';
import BreakdownWidget from './widgets/BreakdownWidget';
import ThroughputWidget from './widgets/ThroughputWidget';
import PulseWidget from './widgets/PulseWidget';
import RecentIssuesWidget from './widgets/RecentIssuesWidget';
import ActivityFeedWidget from './widgets/ActivityFeedWidget';
import AgentRunsWidget from './widgets/AgentRunsWidget';
import AgentHealthWidget from './widgets/AgentHealthWidget';
import WebhookHealthWidget from './widgets/WebhookHealthWidget';
import AgentWorkloadWidget from './widgets/AgentWorkloadWidget';

// The widget body for a given type. Each widget reads its own config and analytics
// query and renders a static view; its config is edited through WidgetSettings.
export default function WidgetBody({
  widget,
  teamKey,
  team,
}: {
  widget: WidgetInstance;
  teamKey: string;
  team: TeamDetail;
}) {
  const config = widget.config ?? {};
  switch (widget.type) {
    case 'stat':
      return <StatWidget config={config} />;
    case 'breakdown':
      return <BreakdownWidget teamKey={teamKey} config={config} />;
    case 'throughput':
      return <ThroughputWidget teamKey={teamKey} config={config} />;
    case 'pulse':
      return <PulseWidget teamKey={teamKey} config={config} />;
    case 'recent_issues':
      return <RecentIssuesWidget teamKey={teamKey} config={config} />;
    case 'activity_feed':
      return <ActivityFeedWidget teamKey={teamKey} team={team} config={config} />;
    case 'agent_runs':
      return <AgentRunsWidget teamKey={teamKey} config={config} />;
    case 'agent_health':
      return <AgentHealthWidget teamKey={teamKey} config={config} />;
    case 'webhook_health':
      return <WebhookHealthWidget teamKey={teamKey} config={config} />;
    case 'agent_workload':
      return <AgentWorkloadWidget teamKey={teamKey} />;
    default:
      return null;
  }
}
