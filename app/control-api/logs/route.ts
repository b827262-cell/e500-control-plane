import { NextResponse } from 'next/server';
import {
  LogDatabaseUnavailableError,
  LogInputError,
  normalizeLogId,
  normalizeLogStage,
  queryExecutionLogs,
  writeExecutionLog,
} from '@/app/lib/execution-logs';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof LogInputError) {
    return NextResponse.json({ ok: false, code: 'LOG_QUERY_INVALID', error: error.message }, { status: 400 });
  }
  if (error instanceof LogDatabaseUnavailableError) {
    return NextResponse.json({ ok: false, code: 'LOG_DB_UNAVAILABLE' }, { status: 503 });
  }
  return NextResponse.json({ ok: false, code: 'LOG_QUERY_FAILED' }, { status: 500 });
}

function parseLimit(value: string | null): number {
  if (value === null || value === '') return 100;
  if (!/^[0-9]{1,3}$/.test(value)) throw new LogInputError('limit 必須是 1～500 的整數');
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new LogInputError('limit 必須是 1～500 的整數');
  }
  return limit;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workflowId = normalizeLogId(url.searchParams.get('workflow_id'), 'workflow_id');
    const jobId = normalizeLogId(url.searchParams.get('job_id'), 'job_id');
    const stage = url.searchParams.get('stage') ? normalizeLogStage(url.searchParams.get('stage')) : null;
    if ((workflowId && jobId) || (!workflowId && !jobId)) {
      throw new LogInputError('workflow_id 或 job_id 必須提供且只能提供一個');
    }
    const logs = await queryExecutionLogs({ workflowId, jobId, stage, limit: parseLimit(url.searchParams.get('limit')) });
    return NextResponse.json({ ok: true, logs, count: logs.length, scope: workflowId ? 'workflow' : 'job', stage });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const persisted = await writeExecutionLog(body);
    if (!persisted) {
      return NextResponse.json({ ok: false, code: 'LOG_DB_UNAVAILABLE' }, { status: 503 });
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
