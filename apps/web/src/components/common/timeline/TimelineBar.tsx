import { cn } from '@/lib/utils';
import type { DateDragMode } from '@/utils/timelineScale';

// A draggable bar on a timeline track. Dragging the body moves it; the optional
// handles at its ends resize it. With `readOnly` it only answers clicks.
export function TimelineBar({
  rect,
  color,
  active,
  readOnly,
  resizeStart,
  resizeEnd,
  title,
  style,
  onBeginDrag,
  onClick,
  children,
}: {
  rect: { left: number; width: number };
  color: string;
  active: boolean;
  readOnly?: boolean;
  resizeStart?: boolean;
  resizeEnd?: boolean;
  title?: string;
  style?: React.CSSProperties;
  onBeginDrag: (e: React.PointerEvent, mode: DateDragMode) => void;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      onPointerDown={readOnly ? undefined : (e) => onBeginDrag(e, 'move')}
      onClick={readOnly ? onClick : undefined}
      className={cn(
        'group absolute top-1/2 z-10 flex h-6 -translate-y-1/2 items-center rounded px-1.5 text-white select-none',
        readOnly ? 'cursor-pointer' : active ? 'cursor-grabbing' : 'cursor-grab',
      )}
      style={{ left: rect.left, width: rect.width, backgroundColor: color, ...style }}
      title={title}
    >
      {children}
      {!readOnly && resizeStart && (
        <span
          onPointerDown={(e) => onBeginDrag(e, 'start')}
          className="absolute top-0 left-0 h-full w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100"
          style={{ background: 'rgba(255,255,255,0.4)' }}
        />
      )}
      {!readOnly && resizeEnd && (
        <span
          onPointerDown={(e) => onBeginDrag(e, 'end')}
          className="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100"
          style={{ background: 'rgba(255,255,255,0.4)' }}
        />
      )}
    </div>
  );
}
