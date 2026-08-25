import { NextResponse } from 'next/server';
import { coerceLogStatus, writeExecutionLogBestEffort } from '@/app/lib/execution-logs';

type BridgeWorkflowResponse = {
  ok?: boolean;
  workflow?: { id?: string; status?: string; current_stage?: string; error?: string | null };
  job?: { id?: string; status?: string; workflow_id?: string | null; error?: string | null };
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
    await writeExecutionLogBestEffort({
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
      await writeExecutionLogBestEffort({
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
    await writeExecutionLogBestEffort({
      job_id: payload.job?.id,
      workflow_id: payload.workflow?.id || payload.job?.workflow_id,
      stage: 'workflow',
      status: response.ok && payload.ok !== false ? coerceLogStatus(payload.workflow?.status || payload.job?.status, 'queued') : (payload.code === 'CODEX_EXEC_RUNNING' ? 'blocked' : 'failed'),
      level: response.ok && payload.ok !== false ? 'info' : (payload.code === 'CODEX_EXEC_RUNNING' ? 'warn' : 'error'),
      source: 'controller',
      message: response.ok && payload.ok !== false ? 'Workflow queued' : (payload.message || payload.code || 'Workflow dispatch failed'),
      detail: payload.workflow?.error || payload.job?.error || payload.workflow?.current_stage || null,
    });
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    await writeExecutionLogBestEffort({
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
