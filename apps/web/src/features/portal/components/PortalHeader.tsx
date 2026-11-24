'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { PortalBoard } from '../services/portal.service';
import PortalVisitorMenu from './PortalVisitorMenu';

// The board's name, its two tabs and the visitor's menu (or Sign in).
export default function PortalHeader({ slug, board }: { slug: string; board: PortalBoard }) {
  const pathname = usePathname();
  const base = `/portal/${slug}`;
  const tabs = [
    { href: base, label: 'Requests', active: pathname === base },
    { href: `${base}/roadmap`, label: 'Roadmap', active: pathname === `${base}/roadmap` },
  ];
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 py-6">
      <Link href={base} className="text-lg font-semibold">
        {board.name}
      </Link>
      {board.canRead && (
        <nav className="flex gap-1" aria-label="Board">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={tab.active ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                tab.active ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      )}
      <div className="ml-auto">
        <PortalVisitorMenu slug={slug} visitor={board.visitor} />
      </div>
    </header>
  );
}
