import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LOCAL_DEV_FALLBACK_ORIGIN,
  parseAllowedHosts,
  parseCanonicalOrigin,
  parseHostHeader,
  resolveMetadataBaseFromHeaders,
  resolveMetadataOrigin,
  type MetadataOriginConfig,
} from '../app/lib/metadata-origin.ts';

const deployedAllowlist = [
  'localhost',
  '127.0.0.1',
  'terminal.local',
  '100.76.46.86',
  'b827262-e500-g9-ws760t.tailc359df.ts.net',
];

const deployedConfig: MetadataOriginConfig = { allowedHosts: deployedAllowlist };

function headersFrom(map: Record<string, string>) {
  return (name: string) => map[name.toLowerCase()] ?? null;
}

describe('parseCanonicalOrigin (deployment-controlled origin validation)', () => {
  it('accepts a valid https origin', () => {
    assert.equal(parseCanonicalOrigin('https://e500.example.com')?.href, 'https://e500.example.com/');
  });

  it('accepts a valid http origin with port', () => {
    assert.equal(parseCanonicalOrigin('http://100.76.46.86:3000')?.href, 'http://100.76.46.86:3000/');
  });

  it('normalizes away path, query and hash', () => {
    assert.equal(parseCanonicalOrigin('https://e500.example.com/path?q=1#frag')?.href, 'https://e500.example.com/');
  });

  it('rejects javascript: URLs', () => {
    assert.equal(parseCanonicalOrigin('javascript:alert(1)'), undefined);
    assert.equal(parseCanonicalOrigin('javascript://e500.example.com'), undefined);
  });

  it('rejects data: URLs', () => {
    assert.equal(parseCanonicalOrigin('data:text/html,<h1>x</h1>'), undefined);
  });

  it('rejects arbitrary protocols', () => {
    assert.equal(parseCanonicalOrigin('ftp://e500.example.com'), undefined);
    assert.equal(parseCanonicalOrigin('file:///etc/passwd'), undefined);
    assert.equal(parseCanonicalOrigin('wss://e500.example.com'), undefined);
  });

  it('rejects credentials in the origin', () => {
    assert.equal(parseCanonicalOrigin('https://user:pass@e500.example.com'), undefined);
  });

  it('rejects malformed, comma-separated and empty values', () => {
    assert.equal(parseCanonicalOrigin('not a url'), undefined);
    assert.equal(parseCanonicalOrigin('https://a.example,https://b.example'), undefined);
    assert.equal(parseCanonicalOrigin(''), undefined);
    assert.equal(parseCanonicalOrigin('   '), undefined);
    assert.equal(parseCanonicalOrigin(undefined), undefined);
    assert.equal(parseCanonicalOrigin(null), undefined);
  });
});

describe('parseAllowedHosts', () => {
  it('parses a comma-separated env string', () => {
    assert.deepEqual(parseAllowedHosts('terminal.local, 100.76.46.86'), ['terminal.local', '100.76.46.86']);
  });

  it('accepts an array and drops invalid entries', () => {
    assert.deepEqual(
      parseAllowedHosts(['localhost', 'attacker.example:4444', 'evil.com/x', 'user@host', '']),
      ['localhost'],
    );
  });

  it('returns an empty list for unset values', () => {
    assert.deepEqual(parseAllowedHosts(undefined), []);
    assert.deepEqual(parseAllowedHosts(null), []);
    assert.deepEqual(parseAllowedHosts(''), []);
  });
});

describe('parseHostHeader', () => {
  it('parses host with port', () => {
    assert.deepEqual(parseHostHeader('100.76.46.86:3000'), { hostname: '100.76.46.86', port: '3000' });
  });

  it('parses host without port', () => {
    assert.deepEqual(parseHostHeader('terminal.local'), { hostname: 'terminal.local', port: null });
  });

  it('rejects comma-separated multi-value headers', () => {
    assert.equal(parseHostHeader('100.76.46.86:3000, evil.com'), undefined);
  });

  it('rejects headers with paths, userinfo or whitespace', () => {
    assert.equal(parseHostHeader('evil.com/x'), undefined);
    assert.equal(parseHostHeader('user:pass@100.76.46.86'), undefined);
    assert.equal(parseHostHeader('evil .com'), undefined);
  });

  it('rejects invalid ports', () => {
    assert.equal(parseHostHeader('100.76.46.86:999999'), undefined);
  });
});

describe('resolveMetadataOrigin (deployment-controlled resolution)', () => {
  it('prefers the canonical env origin over everything else', () => {
    const url = resolveMetadataOrigin(
      { host: '100.76.46.86:3000' },
      { canonicalOrigin: 'https://e500.example.com', allowedHosts: deployedAllowlist },
    );
    assert.equal(url.href, 'https://e500.example.com/');
  });

  it('falls back to the local-dev origin when canonical origin is invalid', () => {
    const url = resolveMetadataOrigin(
      { host: null },
      { canonicalOrigin: 'javascript:alert(1)', allowedHosts: [] },
    );
    assert.equal(url.href, LOCAL_DEV_FALLBACK_ORIGIN + '/');
  });

  it('allows an allowlisted Tailscale IP host with its request port', () => {
    const url = resolveMetadataOrigin({ host: '100.76.46.86:3000' }, deployedConfig);
    assert.equal(url.href, 'http://100.76.46.86:3000/');
  });

  it('allows the allowlisted MagicDNS host', () => {
    const url = resolveMetadataOrigin({ host: 'b827262-e500-g9-ws760t.tailc359df.ts.net:3000' }, deployedConfig);
    assert.equal(url.href, 'http://b827262-e500-g9-ws760t.tailc359df.ts.net:3000/');
  });

  it('matches hosts case-insensitively', () => {
    const url = resolveMetadataOrigin({ host: 'LOCALHOST:3000' }, deployedConfig);
    assert.equal(url.href, 'http://localhost:3000/');
  });

  it('falls back for an unknown Host header', () => {
    const url = resolveMetadataOrigin({ host: 'evil.com:3000' }, deployedConfig);
    assert.equal(url.href, LOCAL_DEV_FALLBACK_ORIGIN + '/');
  });

  it('falls back for an allowlisted hostname with an attacker port mismatch', () => {
    const url = resolveMetadataOrigin({ host: '100.76.46.86:999999' }, deployedConfig);
    assert.equal(url.href, LOCAL_DEV_FALLBACK_ORIGIN + '/');
  });

  it('falls back for comma-separated Host values', () => {
    const url = resolveMetadataOrigin({ host: 'evil.com, 100.76.46.86:3000' }, deployedConfig);
    assert.equal(url.href, LOCAL_DEV_FALLBACK_ORIGIN + '/');
  });

  it('falls back when no host is present', () => {
    assert.equal(resolveMetadataOrigin({ host: null }, deployedConfig).href, LOCAL_DEV_FALLBACK_ORIGIN + '/');
    assert.equal(resolveMetadataOrigin({}, {}).href, LOCAL_DEV_FALLBACK_ORIGIN + '/');
  });

  it('never produces a non-http(s) origin for hostile inputs', () => {
    const hostileHosts = [
      'javascript:alert(1)',
      'data:text/html,x',
      'attacker.example:4444',
      '100.76.46.86:3000@evil.com',
      'evil.com%0d%0aSet-Cookie: x',
      'evil.com/x',
      '[::1]:3000',
      '',
    ];
    for (const host of hostileHosts) {
      const url = resolveMetadataOrigin({ host }, deployedConfig);
      assert.ok(url.protocol === 'http:' || url.protocol === 'https:', `unexpected protocol for host ${JSON.stringify(host)}: ${url.href}`);
      assert.ok(!url.href.includes('evil.com'), `host header leaked into origin: ${url.href}`);
      assert.ok(!url.href.includes('attacker.example'), `host header leaked into origin: ${url.href}`);
    }
  });
});

describe('resolveMetadataBaseFromHeaders (spoofed forwarded headers are ignored)', () => {
  it('ignores spoofed x-forwarded-host and x-forwarded-proto', () => {
    const url = resolveMetadataBaseFromHeaders(
      headersFrom({
        host: '100.76.46.86:3000',
        'x-forwarded-host': 'attacker.example:4444',
        'x-forwarded-proto': 'https',
      }),
      deployedConfig,
    );
    assert.equal(url.href, 'http://100.76.46.86:3000/');
  });

  it('never derives the protocol from x-forwarded-proto', () => {
    for (const proto of ['javascript', 'data', 'https,http', 'ht tp', '%0d%0a']) {
      const url = resolveMetadataBaseFromHeaders(
        headersFrom({
          host: 'terminal.local:3000',
          'x-forwarded-proto': proto,
        }),
        deployedConfig,
      );
      assert.equal(url.protocol, 'http:');
      assert.equal(url.href, 'http://terminal.local:3000/');
    }
  });

  it('does not restore localhost metadata from malformed forwarded headers when Host is allowlisted', () => {
    const url = resolveMetadataBaseFromHeaders(
      headersFrom({
        host: 'b827262-e500-g9-ws760t.tailc359df.ts.net:3000',
        'x-forwarded-proto': 'https,http',
        'x-forwarded-host': 'attacker.example:4444',
      }),
      deployedConfig,
    );
    assert.equal(url.href, 'http://b827262-e500-g9-ws760t.tailc359df.ts.net:3000/');
  });

  it('uses the local-dev fallback, not x-forwarded-host, when Host is missing', () => {
    const url = resolveMetadataBaseFromHeaders(
      headersFrom({ 'x-forwarded-host': 'attacker.example:4444' }),
      deployedConfig,
    );
    assert.equal(url.href, LOCAL_DEV_FALLBACK_ORIGIN + '/');
  });

  it('keeps the canonical origin even under full header spoofing', () => {
    const url = resolveMetadataBaseFromHeaders(
      headersFrom({
        host: 'evil.com',
        'x-forwarded-host': 'attacker.example:4444',
        'x-forwarded-proto': 'javascript',
      }),
      { canonicalOrigin: 'https://e500.example.com', allowedHosts: deployedAllowlist },
    );
    assert.equal(url.href, 'https://e500.example.com/');
  });

  it('uses the deterministic local-dev fallback when nothing is configured', () => {
    const url = resolveMetadataBaseFromHeaders(headersFrom({ host: '100.76.46.86:3000' }), {});
    assert.equal(url.href, LOCAL_DEV_FALLBACK_ORIGIN + '/');
  });
});
