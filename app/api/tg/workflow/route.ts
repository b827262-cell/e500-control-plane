import { NextResponse } from 'next/server';
import { coerceLogStatus, writeExecutionLogOnceBestEffort } from '@/app/lib/execution-logs';
import { buildWorkflowDetail, projectWorkflow, type WorkflowReport, type WorkflowSnapshot } from '@/app/lib/workflow-chain';

type BridgeWorkflowResponse = {
  ok?: boolean;
  workflow?: WorkflowSnapshot;
  job?: { id?: string; status?: string; workflow_id?: string | null; error?: string | null; report?: WorkflowReport | null };
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
    await writeExecutionLogOnceBestEffort({
      stage: 'workflow',
      status: 'blocked',
      level: 'warn',
      source: 'controller',
      message: 'Workflow dispatch blocked: Bridge configuration required',
      detail: 'runtime configuration is incomplete',
    });
    return NextResponse.json(
      { ok: false, code: 'BRIDGE_REQUIRED' },
      { status: 503 },
    );
  }

  try {
    const body = await request.json() as { task?: unknown; mode?: unknown };
    const task = typeof body.task === 'string' ? body.task.trim() : '';
    if (!task || task.length > 12000) {
      await writeExecutionLogOnceBestEffort({
        stage: 'workflow',
        status: 'failed',
        level: 'error',
        source: 'controller',
        message: 'Workflow rejected: task is invalid',
      });
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
    const workflowId = payload.workflow?.id || payload.job?.workflow_id || null;
    const bridgeStatus = response.ok && payload.ok !== false
      ? coerceLogStatus(payload.workflow?.status || payload.job?.status, 'queued')
      : (payload.code === 'CODEX_EXEC_RUNNING' ? 'blocked' : 'failed');
    await writeExecutionLogOnceBestEffort({
      job_id: payload.job?.id,
      workflow_id: workflowId || undefined,
      stage: 'workflow',
      status: bridgeStatus,
      level: response.ok && payload.ok !== false ? 'info' : (payload.code === 'CODEX_EXEC_RUNNING' ? 'warn' : 'error'),
      source: 'controller',
      message: response.ok && payload.ok !== false ? 'Workflow queued' : (payload.message || payload.code || 'Workflow dispatch failed'),
      detail: buildWorkflowDetail({
        workflowId,
        jobId: payload.job?.id,
        originalTask: task,
        report: payload.job?.report,
        error: payload.workflow?.error || payload.job?.error,
        extra: { current_stage: payload.workflow?.current_stage || 'codex' },
      }),
    });
    if (workflowId && response.ok && payload.ok !== false) {
      await writeExecutionLogOnceBestEffort({
        job_id: payload.job?.id,
        workflow_id: workflowId,
        stage: 'codex',
        status: bridgeStatus,
        level: bridgeStatus === 'failed' ? 'error' : 'info',
        source: 'codex',
        message: `GPT / Codex ${bridgeStatus}`,
        detail: buildWorkflowDetail({
          workflowId,
          jobId: payload.job?.id,
          originalTask: task,
          report: payload.job?.report,
          error: payload.job?.error,
        }),
      });
    }
    if (payload.workflow) {
      const projected = projectWorkflow(payload.workflow);
      payload.workflow = {
        ...payload.workflow,
        status: projected.status,
        current_stage: projected.currentStage,
        github_status: projected.reportStatus || payload.workflow.github_status,
        completion: projected.completion,
      } as WorkflowSnapshot & { completion: typeof projected.completion };
    }
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    await writeExecutionLogOnceBestEffort({
      stage: 'workflow',
      status: 'failed',
      level: 'error',
      source: 'control-plane',
      message: error instanceof Error ? error.message : 'Workflow Bridge request failed',
    });
    return NextResponse.json(
      { ok: false, code: 'BRIDGE_UNREACHABLE' },
      { status: 502 },
    );
  }
}
