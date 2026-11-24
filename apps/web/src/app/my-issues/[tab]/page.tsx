import { notFound } from 'next/navigation';
import MyIssuesPage from '@/features/my-issues/MyIssuesPage';
import { isMyIssuesTab } from '@/features/my-issues/utils/myIssues';

export default async function Page({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (!isMyIssuesTab(tab) || tab === 'assigned') notFound();
  return <MyIssuesPage tab={tab} />;
}
