import { NextResponse } from 'next/server';
import { checkBridgeHealth } from '@/app/lib/bridge-health';
import { writeExecutionLogBestEffort } from '@/app/lib/execution-logs';

type TelegramResponse = {
  ok?: boolean;
  result?: {
    id?: number;
    username?: string;
    first_name?: string;
    is_bot?: boolean;
  };
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

  const bridge = bridgeConfig();
  const bridgeCheck = await checkBridgeHealth(bridge);
  if (!bridgeCheck.connected) {
    await writeExecutionLogBestEffort({
      stage: 'telegram',
      status: bridgeCheck.configured ? 'failed' : 'blocked',
      level: bridgeCheck.configured ? 'error' : 'warn',
      source: 'telegram',
      message: `Codex Bridge health check: ${bridgeCheck.code}`,
      detail: 'web BFF GET /api/tg/health proxies native bridge GET /health',
    });
    return NextResponse.json(
      {
        ok: false,
        code: bridgeCheck.code,
        bridgeConfigured: bridgeCheck.configured,
        bridgeConnected: false,
        bridgeCode: bridgeCheck.code,
        bridge: null,
      },
      { status: bridgeCheck.code === 'BRIDGE_REQUIRED' || bridgeCheck.code === 'BRIDGE_AUTH_REQUIRED' ? 503 : 502 },
    );
  }

  if (!token) {
    await writeExecutionLogBestEffort({
      stage: 'telegram',
      status: 'blocked',
      level: 'warn',
      source: 'telegram',
      message: 'Telegram health check blocked: bot configuration required',
    });
    return NextResponse.json(
      { ok: false, code: 'TG_CONFIG_REQUIRED', bridgeConfigured: true, bridgeConnected: true },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      cache: 'no-store',
    });
    const payload = (await response.json()) as TelegramResponse;

    if (!response.ok || !payload.ok || !payload.result?.is_bot) {
      await writeExecutionLogBestEffort({
        stage: 'telegram',
        status: 'failed',
        level: 'error',
        source: 'telegram',
        message: 'Telegram bot health check failed',
        detail: 'Telegram getMe rejected the configured bot credential',
      });
      return NextResponse.json(
        { ok: false, code: 'TG_TOKEN_INVALID', bridgeConfigured: true, bridgeConnected: true },
        { status: 502 },
      );
    }

    await writeExecutionLogBestEffort({
      stage: 'telegram',
      status: 'succeeded',
      level: 'info',
      source: 'telegram',
      message: 'Telegram and Codex Bridge health checks passed',
      detail: 'web /api/tg/health -> bridge /health',
    });

    return NextResponse.json({
      ok: true,
      bot: {
        id: payload.result.id,
        username: payload.result.username,
        name: payload.result.first_name,
      },
      allowedUserCount: allowedUserIds.length,
      bridgeConfigured: true,
      bridgeConnected: true,
      bridgeCode: 'BRIDGE_READY',
      bridge: { service: bridgeCheck.health!.service, api: bridgeCheck.health!.api, queue: bridgeCheck.health!.queue },
    });
  } catch (error) {
    await writeExecutionLogBestEffort({
      stage: 'telegram',
      status: 'failed',
      level: 'error',
      source: 'telegram',
      message: error instanceof Error ? error.message : 'Telegram API health check failed',
    });
    return NextResponse.json(
      { ok: false, code: 'TG_API_UNREACHABLE', bridgeConfigured: true, bridgeConnected: true },
      { status: 502 },
    );
  }
}
