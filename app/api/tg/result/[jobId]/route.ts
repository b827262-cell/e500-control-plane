import { NextResponse } from 'next/server';
import { coerceLogStatus, writeExecutionLogOnceBestEffort } from '@/app/lib/execution-logs';
import { buildWorkflowDetail, canonicalWorkflowStage, type WorkflowReport } from '@/app/lib/workflow-chain';

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
    report?: WorkflowReport | null;
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
    await writeExecutionLogOnceBestEffort({
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
    const stage = canonicalWorkflowStage(payload.job?.workflow_stage, 'codex');
    const status = ok ? coerceLogStatus(payload.job?.status, 'running') : 'failed';
    await writeExecutionLogOnceBestEffort({
      job_id: payload.job?.id || jobId,
      workflow_id: payload.job?.workflow_id,
      stage,
      status,
      level: ok ? 'info' : 'error',
      source: 'codex',
      message: ok ? `GPT / Codex ${status}` : (payload.error || payload.message || payload.code || 'Codex result query failed'),
      detail: buildWorkflowDetail({
        workflowId: payload.job?.workflow_id,
        jobId: payload.job?.id || jobId,
        report: payload.job?.report,
        error: payload.job?.error || payload.error,
      }),
    });
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    await writeExecutionLogOnceBestEffort({
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
