export const LOCAL_DEV_FALLBACK_ORIGIN = 'http://localhost:3000';

export interface MetadataOriginRequest {
  host?: string | null;
}

export interface MetadataOriginConfig {
  canonicalOrigin?: string | null;
  allowedHosts?: string | readonly string[] | null;
}

export interface ParsedHostHeader {
  hostname: string;
  port: string | null;
}

// Canonical origin must be deployment-controlled (env/config), never request-derived.
export function parseCanonicalOrigin(raw: string | null | undefined): URL | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // WHATWG URL allows commas inside hostnames, so reject multi-value inputs
  // (and embedded whitespace) outright before parsing.
  if (/[\s,]/.test(trimmed)) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  if (!url.hostname) return undefined;
  return new URL(url.origin);
}

export function normalizeAllowedHostEntry(entry: string): string | undefined {
  const candidate = entry.trim().toLowerCase();
  if (!candidate) return undefined;
  let url: URL;
  try {
    url = new URL(`http://${candidate}`);
  } catch {
    return undefined;
  }
  if (url.username !== '' || url.password !== '') return undefined;
  if (url.port !== '') return undefined;
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined;
  if (url.hostname !== candidate) return undefined;
  return url.hostname;
}

export function parseAllowedHosts(raw: string | readonly string[] | null | undefined): string[] {
  const parts = Array.isArray(raw) ? [...raw] : typeof raw === 'string' ? raw.split(',') : [];
  const hosts: string[] = [];
  for (const part of parts) {
    const normalized = normalizeAllowedHostEntry(part);
    if (normalized && !hosts.includes(normalized)) hosts.push(normalized);
  }
  return hosts;
}

export function parseHostHeader(raw: string): ParsedHostHeader | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  // Reject multi-value headers ("a, b") and anything with whitespace outright.
  if (/[\s,]/.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(`http://${value}`);
  } catch {
    return undefined;
  }
  if (url.username !== '' || url.password !== '') return undefined;
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined;
  return { hostname: url.hostname, port: url.port === '' ? null : url.port };
}

export function resolveMetadataOrigin(
  request: MetadataOriginRequest,
  config: MetadataOriginConfig,
): URL {
  const canonical = parseCanonicalOrigin(config.canonicalOrigin);
  if (canonical) return canonical;

  const allowedHosts = parseAllowedHosts(config.allowedHosts);
  const host = typeof request.host === 'string' ? parseHostHeader(request.host) : undefined;
  if (host && allowedHosts.includes(host.hostname)) {
    const suffix = host.port ? `:${host.port}` : '';
    try {
      return new URL(`http://${host.hostname}${suffix}`);
    } catch {
      // fall through to the deterministic local-dev fallback
    }
  }
  return new URL(LOCAL_DEV_FALLBACK_ORIGIN);
}

// Trust boundary: only the direct Host header (already constrained by the
// dev-server host allowlist) is consulted. x-forwarded-host / x-forwarded-proto
// are attacker-controllable on this deployment and are intentionally ignored.
export function resolveMetadataBaseFromHeaders(
  getHeader: (name: string) => string | null | undefined,
  config: MetadataOriginConfig,
): URL {
  return resolveMetadataOrigin({ host: getHeader('host') ?? null }, config);
}

export function isValidBareHost(value: string): boolean {
  return normalizeAllowedHostEntry(value) !== undefined;
}
