import { lookup as dnsLookup } from 'node:dns/promises';

// SSRF guard at delivery time. Registration rejects private IP literals and local
// names; a public name can still resolve to an internal address (or be changed to
// one later), so the worker resolves the host before each delivery in production.

// An IPv4/IPv6 address in a loopback, private, link-local, CGNAT or unspecified
// range. An IPv4-mapped IPv6 address is checked as its IPv4.
export function isPrivateIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(mapped ? mapped[1]! : lower);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return (
    lower === '::1' ||
    lower === '::' ||
    /^fe[89ab][0-9a-f]:/.test(lower) ||
    /^f[cd][0-9a-f]{2}:/.test(lower)
  );
}

type Lookup = (host: string) => Promise<{ address: string }[]>;

const systemLookup: Lookup = (host) => dnsLookup(host, { all: true });

// Whether the host (a name or an IP literal) resolves to any private address.
export async function resolvesToPrivate(
  host: string,
  lookup: Lookup = systemLookup,
): Promise<boolean> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (bare === 'localhost' || bare.endsWith('.local') || isPrivateIp(bare)) return true;
  const addresses = await lookup(bare);
  return addresses.some((a) => isPrivateIp(a.address));
}
