'use client';

import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Widget } from '@/utils/dashboards/config';

export interface WidgetActions {
  onEdit: () => void;
  onRemove: () => void;
  onResize: (width: Widget['width']) => void;
}

// A widget's menu: Export CSV always; in edit mode also Edit, Half / Full width and
// Remove.
export default function WidgetMenu({
  widget,
  onExport,
  actions,
}: {
  widget: Widget;
  onExport: (() => void) | null;
  actions: WidgetActions | null;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`${widget.config.title} actions`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={!onExport} onSelect={() => onExport?.()}>
          Export CSV
        </DropdownMenuItem>
        {actions && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={actions.onEdit}>Edit</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => actions.onResize(widget.width === 'half' ? 'full' : 'half')}
            >
              {widget.width === 'half' ? 'Full width' : 'Half width'}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={actions.onRemove}>
              Remove
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
