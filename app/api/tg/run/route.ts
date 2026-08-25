import { NextResponse } from 'next/server';
import { coerceLogStatus, writeExecutionLogOnceBestEffort } from '@/app/lib/execution-logs';
import { buildWorkflowDetail, type WorkflowReport } from '@/app/lib/workflow-chain';

type BridgeJobResponse = {
  ok?: boolean;
  job?: { id?: string; workflow_id?: string | null; status?: string; error?: string | null; report?: WorkflowReport | null };
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
      stage: 'codex',
      status: 'blocked',
      level: 'warn',
      source: 'controller',
      message: 'Codex job dispatch blocked: Bridge configuration required',
      detail: 'runtime configuration is incomplete',
    });
    return NextResponse.json(
      { ok: false, code: 'BRIDGE_REQUIRED' },
      { status: 503 },
    );
  }

  try {
    const body = await request.json() as { task?: unknown; mode?: unknown; provider?: unknown };
    const task = typeof body.task === 'string' ? body.task.trim() : '';
    if (!task || task.length > 12000) {
      await writeExecutionLogOnceBestEffort({
        stage: 'codex',
        status: 'failed',
        level: 'error',
        source: 'controller',
        message: 'Codex job rejected: task is invalid',
      });
      return NextResponse.json(
        { ok: false, code: 'TASK_INVALID' },
        { status: 400 },
      );
    }

    const response = await fetch(`${bridgeUrl}/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bridgeToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        task,
        mode: body.mode ?? 'write',
        provider: body.provider ?? 'codex',
        userId: allowedUserId,
        chatId: allowedUserId,
      }),
      cache: 'no-store',
    });
    const payload = await response.json() as BridgeJobResponse;
    const status = response.ok && payload.ok !== false
      ? coerceLogStatus(payload.job?.status, 'queued')
      : (payload.code === 'CODEX_EXEC_RUNNING' ? 'blocked' : 'failed');
    await writeExecutionLogOnceBestEffort({
      job_id: payload.job?.id,
      workflow_id: payload.job?.workflow_id,
      stage: 'codex',
      status,
      level: response.ok && payload.ok !== false ? 'info' : (payload.code === 'CODEX_EXEC_RUNNING' ? 'warn' : 'error'),
      source: response.ok && payload.ok !== false ? 'codex' : 'controller',
      message: response.ok && payload.ok !== false ? `GPT / Codex ${status}` : (payload.message || payload.code || 'Codex job dispatch failed'),
      detail: buildWorkflowDetail({
        workflowId: payload.job?.workflow_id,
        jobId: payload.job?.id,
        originalTask: task,
        report: payload.job?.report,
        error: payload.job?.error,
      }),
    });
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    await writeExecutionLogOnceBestEffort({
      stage: 'codex',
      status: 'failed',
      level: 'error',
      source: 'control-plane',
      message: error instanceof Error ? error.message : 'Codex Bridge request failed',
    });
    return NextResponse.json(
      { ok: false, code: 'BRIDGE_UNREACHABLE' },
      { status: 502 },
    );
  }
}
