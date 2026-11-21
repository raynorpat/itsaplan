import { describe, expect, it } from 'bun:test';
import { isPrivateIp, resolvesToPrivate } from '../../public-host';

describe('isPrivateIp', () => {
  it('flags loopback, private, link-local, CGNAT and mapped addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ])
      expect(isPrivateIp(ip)).toBe(true);
  });

  it('passes public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('resolvesToPrivate', () => {
  it('is true when any resolved address is private', async () => {
    const lookup = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }];
    expect(await resolvesToPrivate('mixed.example', lookup)).toBe(true);
  });

  it('is false for a host with only public addresses', async () => {
    const lookup = async () => [{ address: '93.184.216.34' }];
    expect(await resolvesToPrivate('example.com', lookup)).toBe(false);
  });
});
