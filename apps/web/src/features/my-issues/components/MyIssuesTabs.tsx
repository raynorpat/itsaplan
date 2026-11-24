import Link from 'next/link';
import { cn } from '@/lib/utils';
import { myIssuesPath } from '@/utils/paths';
import { Button } from '@/components/ui/button';
import { MY_ISSUES_TABS, type MyIssuesTab } from '../utils/myIssues';

// The tab row under the header. Each tab is a route of its own; the button on the
// right shows or hides completed and canceled issues.
export default function MyIssuesTabs({
  active,
  includeCompleted,
  onIncludeCompletedChange,
}: {
  active: MyIssuesTab;
  includeCompleted: boolean;
  onIncludeCompletedChange: (value: boolean) => void;
}) {
  return (
    <nav className="flex h-11 items-center gap-1 border-b px-4">
      {MY_ISSUES_TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.id === 'assigned' ? myIssuesPath() : `${myIssuesPath()}/${tab.id}`}
          className={cn(
            'rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-accent',
            tab.id === active && 'bg-secondary text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto text-muted-foreground"
        aria-pressed={includeCompleted}
        onClick={() => onIncludeCompletedChange(!includeCompleted)}
      >
        {includeCompleted ? 'Hide completed' : 'Show completed'}
      </Button>
    </nav>
  );
}
