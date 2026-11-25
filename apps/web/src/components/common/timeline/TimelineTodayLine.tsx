// The vertical line marking today on a row's track.
export function TimelineTodayLine({ left }: { left: number }) {
  return <div className="absolute top-0 bottom-0 z-0 w-px bg-primary/40" style={{ left }} />;
}
