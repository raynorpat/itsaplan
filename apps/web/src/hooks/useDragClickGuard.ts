import { useRef } from 'react';
import { DRAG_ACTIVATION_DISTANCE } from '@/lib/dnd';

// The browser still fires a click after a drag ends, which would open or toggle the
// dragged row the moment it is dropped. Remember where the press started and treat a
// click that moved further than the drag activation distance as the end of a drag.
export function useDragClickGuard() {
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: { clientX: number; clientY: number }) => {
      pressedAt.current = { x: e.clientX, y: e.clientY };
    },
    isClick: (e: { clientX: number; clientY: number }) => {
      const start = pressedAt.current;
      pressedAt.current = null;
      return (
        !start || Math.hypot(e.clientX - start.x, e.clientY - start.y) <= DRAG_ACTIVATION_DISTANCE
      );
    },
  };
}
