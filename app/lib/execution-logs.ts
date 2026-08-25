import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import {
  executionLogsJobIndexSql,
  executionLogsCurrentFailureSeedSql,
  executionLogsChainIndexSql,
  executionLogsSeedSql,
  executionLogsTableSql,
  executionLogsWorkflowIndexSql,
} from '@/db/schema';

export const LOG_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'blocked'] as const;
export const LOG_LEVELS = ['info', 'warn', 'error'] as const;
export const LOG_SOURCES = ['controller', 'codex', 'agy', 'claude', 'workflow', 'telegram', 'control-plane', 'github'] as const;

export type ExecutionLogStatus = (typeof LOG_STATUSES)[number];
export type ExecutionLogLevel = (typeof LOG_LEVELS)[number];
export type ExecutionLogSource = (typeof LOG_SOURCES)[number];

export type ExecutionLogInput = {
  job_id?: unknown;
  workflow_id?: unknown;
  stage?: unknown;
  status?: unknown;
  level?: unknown;
  source?: unknown;
  message?: unknown;
  detail?: unknown;
};

export type ExecutionLogRecord = {
  id: number;
  job_id: string | null;
  workflow_id: string | null;
  stage: string;
  status: ExecutionLogStatus;
  level: ExecutionLogLevel;
  source: ExecutionLogSource;
  message: string;
  detail: string | null;
  created_at: string;
};

export class LogInputError extends Error {}
export class LogDatabaseUnavailableError extends Error {}

const logIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const logStagePattern = /^[a-z0-9][a-z0-9-]{0,31}$/;
const sensitivePatterns = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /Authorization\s*:\s*[^\s,"'}]+/gi,
  /["']?(?:Authorization|TELEGRAM_BOT_TOKEN|TELEGRAM_TOKEN|CODEX_BRIDGE_API_TOKEN|BRIDGE_TOKEN|OPENAI_API_KEY|token|secret|api[_-]?key|password)["']?\s*[:=]\s*["']?[^\s,"'}]+["']?/gi,
  /\b(?:TELEGRAM_BOT_TOKEN|TELEGRAM_TOKEN|CODEX_BRIDGE_API_TOKEN|BRIDGE_TOKEN|OPENAI_API_KEY)\s*[:=]\s*[^\s,;]+/gi,
  /\b(?:token|secret|api[_-]?key|password)\s*[:=]\s*[^\s,;]+/gi,
];

const databasePromises = new WeakMap<object, Promise<void>>();

export function redactLogText(value: unknown, maxLength = 4000): string {
  let text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (!text) return '';
  for (const pattern of sensitivePatterns) {
    text = text.replace(pattern, (match) => {
      const separator = match.match(/\s*[:=]\s*/)?.[0];
      return separator ? `${match.slice(0, match.indexOf(separator))}${separator}[REDACTED]` : 'Bearer [REDACTED]';
    });
  }
  return text.slice(0, maxLength);
}

export function normalizeLogId(value: unknown, fieldName = 'id'): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !logIdPattern.test(value)) {
    throw new LogInputError(`${fieldName} 格式不正確`);
  }
  return value;
}

export function normalizeLogStage(value: unknown): string {
  if (typeof value !== 'string' || !logStagePattern.test(value)) {
    throw new LogInputError('stage 格式不正確');
  }
  return value;
}

export function normalizeLogStatus(value: unknown): ExecutionLogStatus {
  const status = typeof value === 'string' ? value.toLowerCase() : '';
  if (status === 'completed' || status === 'success' || status === 'successful') return 'succeeded';
  if (status === 'cancelled' || status === 'canceled') return 'failed';
  if ((LOG_STATUSES as readonly string[]).includes(status)) return status as ExecutionLogStatus;
  throw new LogInputError('status 不受支援');
}

export function normalizeLogLevel(value: unknown): ExecutionLogLevel {
  const level = typeof value === 'string' ? value.toLowerCase() : '';
  if ((LOG_LEVELS as readonly string[]).includes(level)) return level as ExecutionLogLevel;
  throw new LogInputError('level 不受支援');
}

export function normalizeLogSource(value: unknown): ExecutionLogSource {
  const source = typeof value === 'string' ? value.toLowerCase() : '';
  if ((LOG_SOURCES as readonly string[]).includes(source)) return source as ExecutionLogSource;
  throw new LogInputError('source 不受支援');
}

export function coerceLogStatus(value: unknown, fallback: ExecutionLogStatus = 'failed'): ExecutionLogStatus {
  try {
    return normalizeLogStatus(value);
  } catch {
    return fallback;
  }
}

export function coerceLogStage(value: unknown, fallback = 'workflow'): string {
  try {
    return normalizeLogStage(value);
  } catch {
    return fallback;
  }
}

function database(): D1Database {
  const configured = (env as unknown as { DB?: D1Database }).DB;
  if (!configured) throw new LogDatabaseUnavailableError('D1 DB binding 未設定');
  return configured;
}

async function ensureExecutionLogSchema(db: D1Database): Promise<void> {
  const current = databasePromises.get(db);
  if (current) return current;
  const pending = db.batch([
    db.prepare(executionLogsTableSql),
    db.prepare(executionLogsWorkflowIndexSql),
    db.prepare(executionLogsJobIndexSql),
    db.prepare(executionLogsChainIndexSql),
    db.prepare(executionLogsSeedSql),
    db.prepare(executionLogsCurrentFailureSeedSql),
    db.prepare('PRAGMA optimize'),
  ]).then(() => undefined).catch((error) => {
    databasePromises.delete(db);
    throw error;
  });
  databasePromises.set(db, pending);
  return pending;
}

type NormalizedExecutionLog = {
  jobId: string | null;
  workflowId: string | null;
  stage: string;
  status: ExecutionLogStatus;
  level: ExecutionLogLevel;
  source: ExecutionLogSource;
  message: string;
  detail: string | null;
};

function normalizeExecutionLog(input: ExecutionLogInput): NormalizedExecutionLog {
  const jobId = normalizeLogId(input.job_id, 'job_id');
  const workflowId = normalizeLogId(input.workflow_id, 'workflow_id');
  const stage = normalizeLogStage(input.stage);
  const status = normalizeLogStatus(input.status);
  const level = normalizeLogLevel(input.level);
  const source = normalizeLogSource(input.source);
  const message = redactLogText(input.message, 1200);
  if (!message) throw new LogInputError('message 不可為空');
  const detail = input.detail === undefined || input.detail === null ? null : redactLogText(input.detail);
  return { jobId, workflowId, stage, status, level, source, message, detail };
}

async function insertExecutionLog(db: D1Database, normalized: NormalizedExecutionLog): Promise<void> {
  await db.prepare(`
    INSERT INTO execution_logs
      (job_id, workflow_id, stage, status, level, source, message, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    normalized.jobId,
    normalized.workflowId,
    normalized.stage,
    normalized.status,
    normalized.level,
    normalized.source,
    normalized.message,
    normalized.detail,
    new Date().toISOString(),
  ).run();
}

async function writeExecutionLogInternal(input: ExecutionLogInput, deduplicate: boolean): Promise<boolean> {
  try {
    const db = database();
    await ensureExecutionLogSchema(db);
    const normalized = normalizeExecutionLog(input);
    if (deduplicate) {
      const existing = await db.prepare(`
        SELECT id
        FROM execution_logs
        WHERE ((job_id = ? AND ? IS NOT NULL) OR (job_id IS NULL AND ? IS NULL))
          AND ((workflow_id = ? AND ? IS NOT NULL) OR (workflow_id IS NULL AND ? IS NULL))
          AND stage = ?
          AND status = ?
          AND level = ?
          AND source = ?
          AND message = ?
          AND ((detail = ? AND ? IS NOT NULL) OR (detail IS NULL AND ? IS NULL))
        ORDER BY id DESC
        LIMIT 1
      `).bind(
        normalized.jobId, normalized.jobId, normalized.jobId,
        normalized.workflowId, normalized.workflowId, normalized.workflowId,
        normalized.stage,
        normalized.status,
        normalized.level,
        normalized.source,
        normalized.message,
        normalized.detail, normalized.detail, normalized.detail,
      ).first<{ id: number }>();
      if (existing) return true;
    }
    await insertExecutionLog(db, normalized);
    return true;
  } catch (error) {
    if (error instanceof LogInputError) throw error;
    console.warn('[control-plane] execution log persistence unavailable');
    return false;
  }
}

export async function writeExecutionLog(input: ExecutionLogInput): Promise<boolean> {
  return writeExecutionLogInternal(input, false);
}

export async function writeExecutionLogOnce(input: ExecutionLogInput): Promise<boolean> {
  return writeExecutionLogInternal(input, true);
}

export async function writeExecutionLogBestEffort(input: ExecutionLogInput): Promise<boolean> {
  try {
    return await writeExecutionLog(input);
  } catch {
    return false;
  }
}

export async function writeExecutionLogOnceBestEffort(input: ExecutionLogInput): Promise<boolean> {
  try {
    return await writeExecutionLogOnce(input);
  } catch {
    return false;
  }
}

function stageFilter(stage: string | null | undefined): { sql: string; values: string[] } {
  if (!stage) return { sql: '', values: [] };
  if (stage === 'gpt') return { sql: ' AND stage IN (?, ?)', values: ['gpt', 'codex'] };
  if (stage === 'report') return { sql: ' AND stage IN (?, ?)', values: ['report', 'workflow'] };
  return { sql: ' AND stage = ?', values: [stage] };
}

export async function queryExecutionLogs(input: { workflowId?: string | null; jobId?: string | null; stage?: string | null; limit: number }): Promise<ExecutionLogRecord[]> {
  const db = database();
  await ensureExecutionLogSchema(db);
  const filter = stageFilter(input.stage);
  if (input.workflowId) {
    const result = await db.prepare(`
      SELECT id, job_id, workflow_id, stage, status, level, source, message, detail, created_at
      FROM execution_logs
      WHERE workflow_id = ?${filter.sql}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).bind(input.workflowId, ...filter.values, input.limit).all<ExecutionLogRecord>();
    return result.results;
  }
  if (input.jobId) {
    const result = await db.prepare(`
      SELECT id, job_id, workflow_id, stage, status, level, source, message, detail, created_at
      FROM execution_logs
      WHERE job_id = ?${filter.sql}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).bind(input.jobId, ...filter.values, input.limit).all<ExecutionLogRecord>();
    return result.results;
  }
  throw new LogInputError('workflow_id 或 job_id 必須提供一個');
}
