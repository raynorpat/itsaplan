'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { feedbackPeoplePath, feedbackReportsPath } from '@/utils/paths';

// The Feedback area's two pages, People and Reports, as links above each page.
export default function FeedbackNav() {
  const pathname = usePathname();
  const items = [
    { href: feedbackPeoplePath(), label: 'People' },
    { href: feedbackReportsPath(), label: 'Reports' },
  ];
  return (
    <nav aria-label="Feedback" className="flex gap-1 px-4 pt-3">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              active && 'bg-accent font-medium text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
