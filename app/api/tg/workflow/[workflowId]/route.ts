import { NextResponse } from 'next/server';
import { coerceLogStage, coerceLogStatus, writeExecutionLogBestEffort } from '@/app/lib/execution-logs';

type BridgeWorkflowResult = {
  ok?: boolean;
  code?: string;
  message?: string;
  error?: string | null;
  workflow?: {
    id?: string;
    status?: string;
    current_stage?: string | null;
    error?: string | null;
    jobs?: Array<{
      id?: string;
      workflow_id?: string | null;
      workflow_stage?: string | null;
      status?: string;
      error?: string | null;
      report?: { summary?: string } | null;
    }>;
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ workflowId: string }> },
) {
  const bridgeUrl = (process.env.CODEX_BRIDGE_URL ?? '').replace(/\/+$/, '');
  const bridgeToken = process.env.CODEX_BRIDGE_API_TOKEN ?? '';
  const { workflowId } = await context.params;

  if (!bridgeUrl || !bridgeToken || !workflowId) {
    await writeExecutionLogBestEffort({
      workflow_id: workflowId,
      stage: 'workflow',
      status: 'blocked',
      level: 'warn',
      source: 'control-plane',
      message: 'Workflow result query blocked: Bridge configuration required',
    });
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
    const payload = await response.json() as BridgeWorkflowResult;
    const ok = response.ok && payload.ok !== false;
    const workflow = payload.workflow;
    const stage = coerceLogStage(workflow?.current_stage, 'workflow');
    const source = stage === 'agy' ? 'agy' : stage === 'claude' ? 'claude' : 'workflow';
    await writeExecutionLogBestEffort({
      workflow_id: workflow?.id || workflowId,
      stage,
      status: ok ? coerceLogStatus(workflow?.status, 'running') : 'failed',
      level: ok ? 'info' : 'error',
      source,
      message: ok ? `Workflow ${workflow?.status || 'running'}` : (payload.error || payload.message || payload.code || 'Workflow result query failed'),
      detail: workflow?.error || null,
    });
    for (const job of workflow?.jobs || []) {
      await writeExecutionLogBestEffort({
        job_id: job.id,
        workflow_id: job.workflow_id || workflow?.id || workflowId,
        stage: coerceLogStage(job.workflow_stage, stage),
        status: coerceLogStatus(job.status, ok ? 'running' : 'failed'),
        level: job.status?.toLowerCase() === 'failed' || job.error ? 'error' : 'info',
        source: job.workflow_stage?.toLowerCase() === 'agy' ? 'agy' : job.workflow_stage?.toLowerCase() === 'claude' ? 'claude' : 'workflow',
        message: job.error || `Workflow ${job.workflow_stage || stage} ${job.status || 'running'}`,
        detail: job.report?.summary || null,
      });
    }
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    await writeExecutionLogBestEffort({
      workflow_id: workflowId,
      stage: 'workflow',
      status: 'failed',
      level: 'error',
      source: 'control-plane',
      message: error instanceof Error ? error.message : 'Workflow result request failed',
    });
    return NextResponse.json(
      { ok: false, code: 'BRIDGE_UNREACHABLE' },
      { status: 502 },
    );
  }
}
