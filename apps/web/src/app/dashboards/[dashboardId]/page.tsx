import DashboardPage from '@/features/dashboards/DashboardPage';

export default async function Page({ params }: { params: Promise<{ dashboardId: string }> }) {
  const { dashboardId } = await params;
  return <DashboardPage dashboardId={dashboardId} />;
}
