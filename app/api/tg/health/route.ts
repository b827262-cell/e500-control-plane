import { NextResponse } from 'next/server';

type TelegramResponse = {
  ok?: boolean;
  result?: {
    id?: number;
    username?: string;
    first_name?: string;
    is_bot?: boolean;
  };
};

type BridgeHealthResponse = {
  ok?: boolean;
  service?: string;
  api?: string;
  queue?: Record<string, number>;
};

function bridgeConfig() {
  return {
    url: (process.env.CODEX_BRIDGE_URL ?? '').replace(/\/+$/, ''),
    token: process.env.CODEX_BRIDGE_API_TOKEN ?? '',
  };
}

export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedUserIds = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!token) {
    return NextResponse.json(
      { ok: false, code: 'TG_CONFIG_REQUIRED', bridgeConfigured: false },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      cache: 'no-store',
    });
    const payload = (await response.json()) as TelegramResponse;

    if (!response.ok || !payload.ok || !payload.result?.is_bot) {
      return NextResponse.json(
        { ok: false, code: 'TG_TOKEN_INVALID', bridgeConfigured: false },
        { status: 502 },
      );
    }

    const bridge = bridgeConfig();
    let bridgeConnected = false;
    let bridgeCode = 'BRIDGE_REQUIRED';
    let bridgeHealth: BridgeHealthResponse | null = null;
    if (bridge.url && bridge.token) {
      try {
        const bridgeResponse = await fetch(`${bridge.url}/health`, {
          headers: { Authorization: `Bearer ${bridge.token}` },
          cache: 'no-store',
        });
        bridgeHealth = (await bridgeResponse.json()) as BridgeHealthResponse;
        bridgeConnected = bridgeResponse.ok && bridgeHealth.ok === true;
        bridgeCode = bridgeConnected ? 'BRIDGE_READY' : 'BRIDGE_UNREACHABLE';
      } catch {
        bridgeCode = 'BRIDGE_UNREACHABLE';
      }
    } else if (bridge.url && !bridge.token) {
      bridgeCode = 'BRIDGE_AUTH_REQUIRED';
    }

    return NextResponse.json({
      ok: true,
      bot: {
        id: payload.result.id,
        username: payload.result.username,
        name: payload.result.first_name,
      },
      allowedUserCount: allowedUserIds.length,
      bridgeConfigured: Boolean(bridge.url),
      bridgeConnected,
      bridgeCode,
      bridge: bridgeHealth ? { service: bridgeHealth.service, api: bridgeHealth.api, queue: bridgeHealth.queue } : null,
    });
  } catch {
    return NextResponse.json(
      { ok: false, code: 'TG_API_UNREACHABLE', bridgeConfigured: false },
      { status: 502 },
    );
  }
}
