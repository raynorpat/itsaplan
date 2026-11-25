// After a drag ends, dnd-kit stops the browser's following click from propagating, so
// React never sees it, but the click's default action still runs: on a link that is a
// full page load of the dragged row's target. Call this when a drag ends to cancel
// that one click in the capture phase. The listener is dropped after `ms` when no
// click comes (a drop away from the row fires none).
export function suppressNextClick(target: EventTarget = window, ms = 100): void {
  const prevent = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    target.removeEventListener('click', prevent, true);
  };
  target.addEventListener('click', prevent, true);
  setTimeout(() => target.removeEventListener('click', prevent, true), ms);
}
