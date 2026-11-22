import { Layers } from 'lucide-react';
import ViewTabChrome from '@/components/layout/ViewTabChrome';

// The fixed All tab.
export default function AllViewTab({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <ViewTabChrome active={active}>
      <button type="button" onClick={onClick} className="flex items-center gap-1.5 py-1 pr-2 pl-2">
        <Layers className="size-3.5" />
        All
      </button>
    </ViewTabChrome>
  );
}
