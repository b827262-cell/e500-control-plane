import { NextResponse } from 'next/server';

type BridgeWorkflowResponse = {
  ok?: boolean;
  workflow?: { id?: string };
  job?: { id?: string };
  code?: string;
  message?: string;
};

export async function POST(request: Request) {
  const bridgeUrl = (process.env.CODEX_BRIDGE_URL ?? '').replace(/\/+$/, '');
  const bridgeToken = process.env.CODEX_BRIDGE_API_TOKEN ?? '';
  const allowedUserId = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .find(Boolean) ?? process.env.TELEGRAM_ALLOWED_CHAT_ID;

  if (!bridgeUrl || !bridgeToken || !allowedUserId) {
    return NextResponse.json(
      { ok: false, code: 'BRIDGE_REQUIRED' },
      { status: 503 },
    );
  }

  try {
    const body = await request.json() as { task?: unknown; mode?: unknown };
    const task = typeof body.task === 'string' ? body.task.trim() : '';
    if (!task || task.length > 12000) {
      return NextResponse.json(
        { ok: false, code: 'TASK_INVALID' },
        { status: 400 },
      );
    }

    const response = await fetch(`${bridgeUrl}/workflow`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bridgeToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        task,
        mode: body.mode ?? 'write',
        userId: allowedUserId,
        chatId: allowedUserId,
      }),
      cache: 'no-store',
    });
    const payload = await response.json() as BridgeWorkflowResponse;
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BRIDGE_UNREACHABLE' },
      { status: 502 },
    );
  }
}
