export type BridgeHealthResponse = {
  ok: true;
  service: 'codex-bridge';
  api: 'v1';
  queue: Record<string, number>;
};

export type BridgeHealthCheck = {
  configured: boolean;
  connected: boolean;
  code: 'BRIDGE_READY' | 'BRIDGE_REQUIRED' | 'BRIDGE_AUTH_REQUIRED' | 'BRIDGE_UNREACHABLE' | 'BRIDGE_INVALID_RESPONSE';
  health: BridgeHealthResponse | null;
};

export type BridgeConfig = { url: string; token: string };

function isQueue(value: unknown): value is Record<string, number> {
  return typeof value === 'object' && value !== null
    && Object.values(value).every((count) => typeof count === 'number');
}

export function isBridgeHealthResponse(value: unknown): value is BridgeHealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  return payload.ok === true
    && payload.service === 'codex-bridge'
    && payload.api === 'v1'
    && isQueue(payload.queue);
}

export async function checkBridgeHealth(
  bridge: BridgeConfig,
  fetcher: typeof fetch = fetch,
): Promise<BridgeHealthCheck> {
  if (!bridge.url) {
    return { configured: false, connected: false, code: 'BRIDGE_REQUIRED', health: null };
  }
  if (!bridge.token) {
    return { configured: true, connected: false, code: 'BRIDGE_AUTH_REQUIRED', health: null };
  }
  try {
    const response = await fetcher(`${bridge.url.replace(/\/+$/, '')}/health`, {
      headers: { Authorization: `Bearer ${bridge.token}` },
      cache: 'no-store',
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { configured: true, connected: false, code: 'BRIDGE_INVALID_RESPONSE', health: null };
    }
    if (!response.ok) {
      return { configured: true, connected: false, code: 'BRIDGE_UNREACHABLE', health: null };
    }
    if (!isBridgeHealthResponse(payload)) {
      return { configured: true, connected: false, code: 'BRIDGE_INVALID_RESPONSE', health: null };
    }
    return { configured: true, connected: true, code: 'BRIDGE_READY', health: payload };
  } catch {
    return { configured: true, connected: false, code: 'BRIDGE_UNREACHABLE', health: null };
  }
}
