import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const bridgeUrl = (process.env.CODEX_BRIDGE_URL ?? '').replace(/\/+$/, '');
  const bridgeToken = process.env.CODEX_BRIDGE_API_TOKEN ?? '';
  const { jobId } = await context.params;

  if (!bridgeUrl || !bridgeToken || !jobId) {
    return NextResponse.json(
      { ok: false, code: 'BRIDGE_REQUIRED' },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${bridgeUrl}/result/${encodeURIComponent(jobId)}`, {
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
