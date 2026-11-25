import { useState } from 'react';
import { dragDates, dragDeltaDays, type DateDragMode } from '@/utils/timelineScale';

export interface DateDragResult {
  start: Date;
  end: Date;
  deltaDays: number;
}

// Pointer-drag of a timeline bar's dates, shared by the issue and project
// timelines. `beginDateDrag` follows the pointer until it is released: `preview`
// is the in-progress span of the dragged item, `onMove` sees each pointer move
// (the issue timeline reads the row under the pointer there), and `onDrop` gets
// the final dates and how many days they moved.
export function useTimelineDateDrag({ dayW }: { dayW: number }) {
  const [preview, setPreview] = useState<{ id: string; start: Date; end: Date } | null>(null);

  function beginDateDrag(
    e: React.PointerEvent,
    {
      id,
      start,
      end,
      mode,
      onMove,
      onDrop,
    }: {
      id: string;
      start: Date;
      end: Date;
      mode: DateDragMode;
      onMove?: (ev: PointerEvent) => void;
      onDrop: (result: DateDragResult) => void;
    },
  ) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    let current: DateDragResult = { start, end, deltaDays: 0 };

    const move = (ev: PointerEvent) => {
      const deltaDays = dragDeltaDays(ev.clientX - startX, dayW);
      current = { ...dragDates({ mode, start, end, deltaDays }), deltaDays };
      onMove?.(ev);
      setPreview({ id, start: current.start, end: current.end });
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPreview(null);
      onDrop(current);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return { preview, beginDateDrag };
}
