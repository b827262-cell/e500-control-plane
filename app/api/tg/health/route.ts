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

    return NextResponse.json({
      ok: true,
      bot: {
        id: payload.result.id,
        username: payload.result.username,
        name: payload.result.first_name,
      },
      allowedUserCount: allowedUserIds.length,
      bridgeConfigured: Boolean(process.env.CODEX_BRIDGE_URL),
    });
  } catch {
    return NextResponse.json(
      { ok: false, code: 'TG_API_UNREACHABLE', bridgeConfigured: false },
      { status: 502 },
    );
  }
}
