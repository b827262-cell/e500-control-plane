import { NextResponse } from 'next/server';
import { coerceLogStage, coerceLogStatus, writeExecutionLogBestEffort } from '@/app/lib/execution-logs';

type BridgeJobResult = {
  ok?: boolean;
  code?: string;
  message?: string;
  job?: {
    id?: string;
    workflow_id?: string | null;
    workflow_stage?: string | null;
    status?: string;
    error?: string | null;
    report?: { summary?: string } | null;
  };
  error?: string | null;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const bridgeUrl = (process.env.CODEX_BRIDGE_URL ?? '').replace(/\/+$/, '');
  const bridgeToken = process.env.CODEX_BRIDGE_API_TOKEN ?? '';
  const { jobId } = await context.params;

  if (!bridgeUrl || !bridgeToken || !jobId) {
    await writeExecutionLogBestEffort({
      job_id: jobId,
      stage: 'codex',
      status: 'blocked',
      level: 'warn',
      source: 'control-plane',
      message: 'Codex result query blocked: Bridge configuration required',
    });
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
    const payload = await response.json() as BridgeJobResult;
    const ok = response.ok && payload.ok !== false;
    await writeExecutionLogBestEffort({
      job_id: payload.job?.id || jobId,
      workflow_id: payload.job?.workflow_id,
      stage: coerceLogStage(payload.job?.workflow_stage, 'codex'),
      status: ok ? coerceLogStatus(payload.job?.status, 'running') : 'failed',
      level: ok ? 'info' : 'error',
      source: 'codex',
      message: ok ? `Codex job ${payload.job?.status || 'running'}` : (payload.error || payload.message || payload.code || 'Codex result query failed'),
      detail: payload.job?.error || payload.job?.report?.summary || null,
    });
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    await writeExecutionLogBestEffort({
      job_id: jobId,
      stage: 'codex',
      status: 'failed',
      level: 'error',
      source: 'control-plane',
      message: error instanceof Error ? error.message : 'Codex result request failed',
    });
    return NextResponse.json(
      { ok: false, code: 'BRIDGE_UNREACHABLE' },
      { status: 502 },
    );
  }
}
