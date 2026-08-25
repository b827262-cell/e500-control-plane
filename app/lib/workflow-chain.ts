import {
  coerceLogStatus,
  redactLogText,
  type ExecutionLogStatus,
} from '@/app/lib/execution-logs';

export type WorkflowReport = {
  summary?: unknown;
  result_summary?: unknown;
  review?: unknown;
  changed_files?: unknown;
  tests?: unknown;
  git_status?: unknown;
  needs_attention?: unknown;
  report_path?: unknown;
  commit_sha?: unknown;
  github_url?: unknown;
  github_status?: unknown;
};

export type WorkflowJobSnapshot = {
  id?: string;
  workflow_id?: string | null;
  workflow_stage?: string | null;
  status?: string;
  progress?: number | null;
  error?: string | null;
  report?: WorkflowReport | null;
};

export type WorkflowSnapshot = {
  id?: string;
  status?: string;
  current_stage?: string | null;
  github_url?: string | null;
  github_status?: string | null;
  report_path?: string | null;
  commit_sha?: string | null;
  error?: string | null;
  jobs?: WorkflowJobSnapshot[];
};

export type ChainStage = 'codex' | 'agy' | 'claude' | 'report';

export type WorkflowCompletion = {
  codex: ExecutionLogStatus;
  agy: ExecutionLogStatus;
  claude: ExecutionLogStatus;
  report: ExecutionLogStatus;
  all_succeeded: boolean;
  needs_attention: boolean;
  percentage: number;
};

export type WorkflowProjection = {
  status: ExecutionLogStatus;
  currentStage: string;
  completion: WorkflowCompletion;
  reportStatus: ExecutionLogStatus | null;
  reportFailure: string | null;
};

const AGENT_STAGES = ['codex', 'agy', 'claude'] as const;

function lower(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function canonicalWorkflowStage(value: unknown, fallback: ChainStage = 'codex'): ChainStage {
  const stage = lower(value);
  if (stage === 'gpt' || stage === 'codex') return 'codex';
  if (stage === 'agy') return 'agy';
  if (stage === 'claude') return 'claude';
  if (stage === 'github' || stage === 'report') return 'report';
  return fallback;
}

export function workflowStageSource(stage: ChainStage): 'codex' | 'agy' | 'claude' | 'github' {
  return stage === 'report' ? 'github' : stage;
}

function normalizedStatus(value: unknown, fallback: ExecutionLogStatus = 'queued'): ExecutionLogStatus {
  try {
    return coerceLogStatus(value, fallback);
  } catch {
    return fallback;
  }
}

function isSucceeded(status: ExecutionLogStatus): boolean {
  return status === 'succeeded';
}

function isFailed(status: ExecutionLogStatus): boolean {
  return status === 'failed';
}

function safeValue(value: unknown, maxLength = 1200): string | null {
  if (value === undefined || value === null || value === '') return null;
  return redactLogText(value, maxLength) || null;
}

function safeList(value: unknown, maxItems = 80): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.slice(0, maxItems).map((item) => redactLogText(item, 500)).filter(Boolean);
}

function reportFields(report: WorkflowReport | null | undefined) {
  if (!report) return {};
  return {
    result_summary: safeValue(report.summary ?? report.result_summary),
    review: safeValue(report.review),
    changed_files: safeList(report.changed_files),
    tests: safeList(report.tests),
    git_status: safeValue(report.git_status),
    needs_attention: typeof report.needs_attention === 'boolean' ? report.needs_attention : safeValue(report.needs_attention, 80),
    report_path: safeValue(report.report_path, 500),
    commit_sha: safeValue(report.commit_sha, 200),
    github_url: safeValue(report.github_url, 800),
    github_status: safeValue(report.github_status, 120),
  };
}

export function buildWorkflowDetail(input: {
  workflowId?: string | null;
  jobId?: string | null;
  originalTask?: unknown;
  report?: WorkflowReport | null;
  error?: unknown;
  extra?: Record<string, unknown>;
}): string {
  const detail = {
    original_task: safeValue(input.originalTask, 1800),
    ...reportFields(input.report),
    error: safeValue(input.error),
    job_id: input.jobId || null,
    workflow_id: input.workflowId || null,
    ...input.extra,
  };
  return redactLogText(JSON.stringify(detail), 4000);
}

export function extractOriginalTask(detail: string | null | undefined): string | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail) as { original_task?: unknown };
    return typeof parsed.original_task === 'string' ? parsed.original_task : null;
  } catch {
    return null;
  }
}

function stageJob(workflow: WorkflowSnapshot, stage: ChainStage): WorkflowJobSnapshot | undefined {
  const jobs = workflow.jobs || [];
  return [...jobs].reverse().find((job) => canonicalWorkflowStage(job.workflow_stage, stage) === stage);
}

function reportStatus(workflow: WorkflowSnapshot): { status: ExecutionLogStatus | null; failure: string | null } {
  const raw = lower(workflow.github_status);
  if (workflow.github_url || ['success', 'succeeded', 'completed', 'created', 'published', 'ready'].includes(raw)) {
    return { status: 'succeeded', failure: null };
  }
  if (['failed', 'failure', 'error'].includes(raw)) {
    return { status: 'failed', failure: 'GitHub Markdown report failed' };
  }
  if (['queued', 'running', 'pending', 'building'].includes(raw) || lower(workflow.current_stage) === 'github' || lower(workflow.current_stage) === 'report') {
    return { status: raw === 'running' ? 'running' : 'queued', failure: null };
  }
  if (lower(workflow.status) === 'succeeded') {
    return { status: 'failed', failure: 'GitHub Markdown report status unavailable' };
  }
  return { status: null, failure: null };
}

export function projectWorkflow(workflow: WorkflowSnapshot): WorkflowProjection {
  const rawStatuses = Object.fromEntries(AGENT_STAGES.map((stage) => {
    const job = stageJob(workflow, stage);
    const fallback = lower(workflow.current_stage) === stage ? normalizedStatus(workflow.status, 'running') : 'queued';
    return [stage, normalizedStatus(job?.status, fallback)];
  })) as Record<'codex' | 'agy' | 'claude', ExecutionLogStatus>;
  let priorFailure = false;
  const statuses = Object.fromEntries(AGENT_STAGES.map((stage) => {
    const status = priorFailure ? 'blocked' : rawStatuses[stage];
    if (status === 'failed' || status === 'blocked') priorFailure = true;
    return [stage, status];
  })) as Record<'codex' | 'agy' | 'claude', ExecutionLogStatus>;
  const rawReport = reportStatus(workflow);
  const report = rawReport.status
    ? rawReport
    : priorFailure
      ? { status: 'blocked' as const, failure: 'GitHub Markdown report blocked by a previous stage failure' }
      : rawReport;
  const completion: WorkflowCompletion = {
    codex: statuses.codex,
    agy: statuses.agy,
    claude: statuses.claude,
    report: report.status || 'queued',
    all_succeeded: isSucceeded(statuses.codex) && isSucceeded(statuses.agy) && isSucceeded(statuses.claude) && report.status === 'succeeded',
    needs_attention: AGENT_STAGES.some((stage) => isFailed(statuses[stage])) || report.status === 'failed',
    percentage: Math.round((AGENT_STAGES.filter((stage) => isSucceeded(statuses[stage])).length + (report.status === 'succeeded' ? 1 : 0)) / 4 * 100),
  };
  const failedStage = AGENT_STAGES.find((stage) => isFailed(statuses[stage]));
  const currentStage = failedStage || (completion.all_succeeded ? 'github' : canonicalWorkflowStage(workflow.current_stage, 'codex'));
  const status: ExecutionLogStatus = completion.all_succeeded
    ? 'succeeded'
    : completion.needs_attention
      ? 'failed'
      : normalizedStatus(workflow.status, currentStage === 'codex' ? 'queued' : 'running');
  return { status, currentStage, completion, reportStatus: report.status, reportFailure: report.failure };
}

export function jobStatusForLog(workflow: WorkflowSnapshot, stage: ChainStage): ExecutionLogStatus {
  if (stage === 'report') return projectWorkflow(workflow).completion.report;
  return projectWorkflow(workflow).completion[stage];
}

export function hasReportSignal(workflow: WorkflowSnapshot): boolean {
  return Boolean(workflow.github_url || workflow.github_status || lower(workflow.current_stage) === 'github' || lower(workflow.current_stage) === 'report');
}
