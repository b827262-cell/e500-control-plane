import { NextResponse } from 'next/server';
import { queryExecutionLogs, writeExecutionLogOnceBestEffort } from '@/app/lib/execution-logs';
import {
  buildWorkflowDetail,
  canonicalWorkflowStage,
  extractOriginalTask,
  hasReportSignal,
  jobStatusForLog,
  projectWorkflow,
  workflowStageSource,
  type WorkflowSnapshot,
} from '@/app/lib/workflow-chain';

type BridgeWorkflowResult = {
  ok?: boolean;
  code?: string;
  message?: string;
  error?: string | null;
  workflow?: WorkflowSnapshot;
};

type ProjectedWorkflow = WorkflowSnapshot & {
  completion: ReturnType<typeof projectWorkflow>['completion'];
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ workflowId: string }> },
) {
  const bridgeUrl = (process.env.CODEX_BRIDGE_URL ?? '').replace(/\/+$/, '');
  const bridgeToken = process.env.CODEX_BRIDGE_API_TOKEN ?? '';
  const { workflowId } = await context.params;

  if (!bridgeUrl || !bridgeToken || !workflowId) {
    await writeExecutionLogOnceBestEffort({
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
    const projection = workflow ? projectWorkflow(workflow) : {
      status: 'failed' as const,
      currentStage: 'workflow',
      completion: {
        codex: 'failed' as const,
        agy: 'queued' as const,
        claude: 'queued' as const,
        report: 'queued' as const,
        all_succeeded: false,
        needs_attention: true,
        percentage: 0,
      },
      reportStatus: null,
      reportFailure: null,
    };
    const resolvedWorkflowId = workflow?.id || workflowId;
    let originalTask: string | null = null;
    try {
      const priorCodexLogs = await queryExecutionLogs({ workflowId: resolvedWorkflowId, stage: 'codex', limit: 100 });
      originalTask = priorCodexLogs.map((log) => extractOriginalTask(log.detail)).find(Boolean) || null;
    } catch {
      // The lifecycle response remains useful even when context lookup is unavailable.
    }

    await writeExecutionLogOnceBestEffort({
      workflow_id: resolvedWorkflowId,
      stage: 'workflow',
      status: ok ? projection.status : 'failed',
      level: ok && projection.status !== 'failed' ? 'info' : 'error',
      source: 'workflow',
      message: ok ? `Workflow ${projection.status}` : (payload.error || payload.message || payload.code || 'Workflow result query failed'),
      detail: buildWorkflowDetail({
        workflowId: resolvedWorkflowId,
        originalTask,
        error: workflow?.error || payload.error || payload.message,
        extra: {
          current_stage: projection.currentStage,
          completion: projection.completion,
        },
      }),
    });

    for (const job of workflow?.jobs || []) {
      const stage = canonicalWorkflowStage(job.workflow_stage, canonicalWorkflowStage(workflow?.current_stage, 'codex'));
      if (stage === 'report') continue;
      const status = jobStatusForLog(workflow || {}, stage);
      await writeExecutionLogOnceBestEffort({
        job_id: job.id,
        workflow_id: job.workflow_id || resolvedWorkflowId,
        stage,
        status,
        level: status === 'failed' ? 'error' : status === 'blocked' ? 'warn' : 'info',
        source: workflowStageSource(stage),
        message: `${stage === 'codex' ? 'GPT / Codex' : stage.toUpperCase()} ${status}`,
        detail: buildWorkflowDetail({
          workflowId: job.workflow_id || resolvedWorkflowId,
          jobId: job.id,
          originalTask,
          report: job.report,
          error: job.error,
        }),
      });
    }

    if (projection.reportStatus && (hasReportSignal(workflow || {}) || projection.reportStatus === 'failed' || projection.reportStatus === 'blocked')) {
      await writeExecutionLogOnceBestEffort({
        workflow_id: resolvedWorkflowId,
        stage: 'report',
        status: projection.reportStatus,
        level: projection.reportStatus === 'failed' ? 'error' : 'info',
        source: 'github',
        message: projection.reportStatus === 'succeeded'
          ? 'GitHub Markdown report created'
          : projection.reportFailure || `GitHub Markdown report ${projection.reportStatus}`,
        detail: buildWorkflowDetail({
          workflowId: resolvedWorkflowId,
          originalTask,
          report: {
            github_url: workflow?.github_url,
            github_status: workflow?.github_status,
            report_path: workflow?.report_path,
            commit_sha: workflow?.commit_sha,
          },
          error: projection.reportFailure,
          extra: {
            report_path: workflow?.report_path || `reports/${resolvedWorkflowId}.md`,
            commit_sha: workflow?.commit_sha || null,
            github_url: workflow?.github_url || null,
          },
        }),
      });
    }

    if (workflow) {
      const normalizedWorkflow: ProjectedWorkflow = {
        ...workflow,
        id: resolvedWorkflowId,
        status: ok ? projection.status : 'failed',
        current_stage: projection.currentStage,
        github_status: projection.reportStatus || workflow.github_status,
        error: workflow.error || projection.reportFailure,
        completion: projection.completion,
      };
      payload.workflow = normalizedWorkflow;
    }
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    await writeExecutionLogOnceBestEffort({
      workflow_id: workflowId,
      stage: 'workflow',
      status: 'failed',
      level: 'error',
      source: 'control-plane',
      message: error instanceof Error ? error.message : 'Workflow result request failed',
      detail: `flow_id=${workflowId}; query=/workflow ${workflowId}`,
    });
    return NextResponse.json(
      { ok: false, code: 'BRIDGE_UNREACHABLE' },
      { status: 502 },
    );
  }
}
