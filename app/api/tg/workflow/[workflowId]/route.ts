import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  context: { params: Promise<{ workflowId: string }> },
) {
  const bridgeUrl = (process.env.CODEX_BRIDGE_URL ?? '').replace(/\/+$/, '');
  const bridgeToken = process.env.CODEX_BRIDGE_API_TOKEN ?? '';
  const { workflowId } = await context.params;

  if (!bridgeUrl || !bridgeToken || !workflowId) {
    return NextResponse.json(
      { ok: false, code: 'BRIDGE_REQUIRED' },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${bridgeUrl}/workflow/${encodeURIComponent(workflowId)}`, {
      headers: { Authorization: `Bearer ${bridgeToken}` },
      cache: 'no-store',
    });
    const payload = await response.json() as unknown;
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BRIDGE_UNREACHABLE' },
      { status: 502 },
    );
  }
}
