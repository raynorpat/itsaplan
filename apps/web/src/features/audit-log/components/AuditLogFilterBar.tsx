'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { NO_FILTERS, type AuditLogFilters } from '../utils/auditLog';

const ANY = '__any';

// Filters by action, person, IP address and days (UTC).
export default function AuditLogFilterBar({
  filters,
  types,
  people,
  onChange,
}: {
  filters: AuditLogFilters;
  types: { type: string; description: string }[];
  people: { id: string; name: string }[];
  onChange: (next: AuditLogFilters) => void;
}) {
  const set = (patch: Partial<AuditLogFilters>) => onChange({ ...filters, ...patch });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        value={filters.type ?? ANY}
        onValueChange={(v) => set({ type: v === ANY ? null : v })}
      >
        <SelectTrigger size="sm" className="h-8 w-56 text-xs" aria-label="Action">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All actions</SelectItem>
          {types.map((t) => (
            <SelectItem key={t.type} value={t.type}>
              {t.description}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.actorId ?? ANY}
        onValueChange={(v) => set({ actorId: v === ANY ? null : v })}
      >
        <SelectTrigger size="sm" className="h-8 w-44 text-xs" aria-label="Person">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Everyone</SelectItem>
          {people.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        className="h-8 w-36 text-xs"
        placeholder="IP address"
        aria-label="IP address"
        value={filters.ip}
        onChange={(e) => set({ ip: e.target.value })}
      />
      <Input
        type="date"
        className="h-8 w-36 text-xs"
        aria-label="From"
        value={filters.from}
        onChange={(e) => set({ from: e.target.value })}
      />
      <Input
        type="date"
        className="h-8 w-36 text-xs"
        aria-label="To"
        value={filters.to}
        onChange={(e) => set({ to: e.target.value })}
      />
      <Button variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>
        Clear
      </Button>
    </div>
  );
}
