'use client';

import { useState } from 'react';
import { avatarColor, initials } from '@/utils/avatar';
import { cn } from '@/lib/utils';

// An OAuth application's icon. The icon URL is on the application's own host, which
// next/image does not allow (it only fetches from the API's origin), so a plain img
// shows it; without one, or if it fails to load, the application's initials.
export default function AppIcon({
  name,
  iconUrl,
  className,
}: {
  name: string;
  iconUrl: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = Boolean(iconUrl) && failed !== iconUrl;
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md text-xs font-semibold text-white',
        className,
      )}
      style={{ backgroundColor: show ? undefined : avatarColor(initials(name)) }}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- an external host (see above)
        <img
          src={iconUrl!}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailed(iconUrl)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
