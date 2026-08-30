'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

const command = '/run 修正 Telegram worker 的 timeout lock cleanup，完成後執行 pytest，不要 push。';
const MAX_TASK_LENGTH = 12000;
const defaultWorkflowId = 'flow-abfbbaa69b6247dc';

type LifecycleKey = 'queued' | 'running' | 'succeeded' | 'failed' | 'agy' | 'claude';

const lifecycle: Array<{ key: LifecycleKey; number: string; label: string; title: string; detail: string; color: string; stage: string }> = [
  {
    key: 'queued',
    number: '01',
    label: 'QUEUED',
    title: '任務進入佇列',
    detail: 'Controller 建立 job_id，檢查 workspace 與 provider，回傳可追蹤的任務卡。',
    color: 'violet',
    stage: 'controller',
  },
  {
    key: 'running',
    number: '02',
    label: 'RUNNING',
    title: 'Codex 開始工作',
    detail: 'Dispatcher 將任務送往 Codex，在隔離環境裡讀 repo、改程式並執行測試。',
    color: 'blue',
    stage: 'codex',
  },
  {
    key: 'succeeded',
    number: '03',
    label: 'SUCCEEDED',
    title: '結果回到 Telegram',
    detail: 'Result Collector 整理摘要、changed files 與測試結果，讓你在手機上 review。',
    color: 'green',
    stage: 'workflow',
  },
  {
    key: 'failed',
    number: '04',
    label: 'FAILED',
    title: '失敗也要可追蹤',
    detail: '保留錯誤、log 與 job 狀態；下一步可以 cancel、重試或人工介入。',
    color: 'red',
    stage: 'workflow',
  },
  {
    key: 'agy',
    number: '05',
    label: 'AGY',
    title: 'AGY review stage',
    detail: '檢查 Codex 產物、測試輸出與修正項目，所有 review 事件寫入同一條 workflow log。',
    color: 'yellow',
    stage: 'agy',
  },
  {
    key: 'claude',
    number: '06',
    label: 'CLAUDE',
    title: 'Claude final stage',
    detail: '完成最後整理與回報，保留 stage、來源、狀態與可展開的詳細資訊。',
    color: 'pink',
    stage: 'claude',
  },
];

const commands = [
  ['/ping', 'Bot / worker 健康檢查'],
  ['/run <task>', '預設送往 Codex'],
  ['/gpt-smoke <task>', 'Codex → AGY → Claude；不寫入 GitHub（live smoke 預設）'],
  ['/gpt <task>', 'Codex → AGY → Claude → GitHub 報告'],
  ['/agy <task>', '排入 AGY review queue'],
  ['/claude <task>', '排入 Claude final queue'],
  ['/status', '查看 queue 與 running jobs'],
  ['/workflow <flow_id>', '查詢串接流程'],
];

function Arrow() {
  return <span className="pipeline-arrow" aria-hidden="true">→</span>;
}

type DispatchState = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'checking' | 'verified';
type DispatchPhase = 'queued' | 'running' | 'completed' | 'failed';
type BridgeHealthState = 'checking' | 'connected' | 'pending' | 'offline';

type JobPayload = {
  id?: string;
  workflow_stage?: string | null;
  workflow_id?: string | null;
  started_at?: string | null;
  status?: string;
  error?: string | null;
  report?: {
    summary?: string;
  } | null;
};

type WorkflowJobPayload = {
  id?: string;
  workflow_stage?: string | null;
  status?: string;
  progress?: number | null;
  error?: string | null;
  report?: {
    summary?: string;
  } | null;
};

type WorkflowPayload = {
  id?: string;
  status?: string;
  current_stage?: string;
  github_url?: string | null;
  github_status?: string | null;
  error?: string | null;
  jobs?: WorkflowJobPayload[];
  completion?: {
    codex?: string;
    agy?: string;
    claude?: string;
    report?: string;
    all_succeeded?: boolean;
    needs_attention?: boolean;
    percentage?: number;
  };
};

type LifecycleQuery = {
  key: LifecycleKey;
  stage: string;
  loading: boolean;
  logs: ExecutionLogRecord[];
  message?: string;
  scope?: 'workflow' | 'job';
  queryCommand?: string;
  offlineMessage?: string;
  offline?: boolean;
  error?: boolean;
};

type ExecutionLogRecord = {
  id: number;
  job_id: string | null;
  workflow_id: string | null;
  stage: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked';
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
  detail: string | null;
  created_at: string;
};

type WorkflowLightState = 'green' | 'progress' | 'red' | 'off';
type WorkflowStage = 'gpt' | 'agy' | 'claude';
type WebsiteView = 'frontend' | 'backend';
type SyncStatus = 'idle' | 'checking' | 'syncing' | 'success' | 'error' | 'local-only';

const syncButtonLabels: Record<SyncStatus, string> = {
  idle: '同步鍵',
  checking: '同步鍵',
  syncing: '同步中',
  success: '已同步',
  error: '同步失敗',
  'local-only': '本機限定',
};

function subscribeToLocation(callback: () => void) {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

function getIsLocalhost(): boolean {
  if (typeof window === 'undefined') return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

const workflowStages: Array<{ key: WorkflowStage; label: string }> = [
  { key: 'gpt', label: 'GPT / CODEX' },
  { key: 'agy', label: 'AGY' },
  { key: 'claude', label: 'CLAUDE' },
];

const workflowLightLabels: Record<WorkflowLightState, string> = {
  green: '通過',
  progress: '進行中',
  red: '失敗',
  off: '等待',
};

type PipelineNodeKey = 'telegram' | 'controller' | 'gpt' | 'agy' | 'claude' | 'report';
type PipelineNodeState = 'idle' | 'active' | 'done' | 'failed';

function getPipelineNodeState(workflow: WorkflowPayload | null, node: PipelineNodeKey): PipelineNodeState {
  if (!workflow) return 'idle';
  const completionKey = node === 'gpt' ? 'codex' : node;
  const completionStatus = completionKey === 'telegram' || completionKey === 'controller'
    ? undefined
    : workflow.completion?.[completionKey as 'codex' | 'agy' | 'claude' | 'report'];
  if (completionStatus === 'failed' || completionStatus === 'blocked') return 'failed';
  if (completionStatus === 'succeeded') return 'done';
  const currentStage = workflow.current_stage?.toLowerCase();
  const status = workflow.status?.toLowerCase();
  const nodeIndex: Record<PipelineNodeKey, number> = {
    telegram: 0,
    controller: 1,
    gpt: 2,
    agy: 3,
    claude: 4,
    report: 5,
  };
  const currentIndex = currentStage === 'agy'
    ? 3
    : currentStage === 'claude'
      ? 4
      : currentStage === 'github'
        ? 5
        : 2;
  const index = nodeIndex[node];
  const isFailedNode = status === 'failed' && ((currentStage === node) || (node === 'report' && currentStage === 'github'));
  if (isFailedNode) return 'failed';
  if (status === 'succeeded' || index < currentIndex) return 'done';
  if (index === currentIndex) return 'active';
  return 'idle';
}

function getWorkflowCompletion(workflow: WorkflowPayload | null): number {
  if (!workflow) return 0;
  if (typeof workflow.completion?.percentage === 'number') return workflow.completion.percentage;
  if (workflow.status?.toLowerCase() === 'succeeded') return 100;
  if (workflow.current_stage?.toLowerCase() === 'github') return 95;
  const completed = (workflow.jobs || []).filter((job) => {
    const status = job.status?.toLowerCase();
    return status === 'succeeded' || status === 'completed' || status === 'success';
  }).length;
  const currentStage = workflow.current_stage?.toLowerCase();
  const inProgress = currentStage === 'gpt' || currentStage === 'agy' || currentStage === 'claude' ? .5 : 0;
  return Math.min(99, Math.round(((completed + inProgress) / 3) * 100));
}

function getWorkflowLight(workflow: WorkflowPayload | null, stage: WorkflowStage): WorkflowLightState {
  const completionStatus = workflow?.completion?.[stage === 'gpt' ? 'codex' : stage];
  if (completionStatus === 'succeeded') return 'green';
  if (completionStatus === 'failed' || completionStatus === 'blocked') return 'red';
  if (completionStatus === 'queued' || completionStatus === 'running') return 'progress';
  const job = workflow?.jobs?.find((item) => item.workflow_stage?.toLowerCase() === stage);
  const status = job?.status?.toLowerCase();
  if (workflow?.status === 'failed' && workflow.current_stage?.toLowerCase() === stage) return 'red';
  if (status === 'succeeded' || status === 'completed' || status === 'success') return 'green';
  if (status === 'failed' || status === 'cancelled' || status === 'canceled') return 'red';
  if (status === 'queued' || status === 'running') return 'progress';
  if ((workflow?.status === 'queued' || workflow?.status === 'running') && workflow.current_stage?.toLowerCase() === stage) return 'progress';
  return 'off';
}

function getWorkflowProgress(workflow: WorkflowPayload | null, stage: WorkflowStage): number {
  const completionStatus = workflow?.completion?.[stage === 'gpt' ? 'codex' : stage];
  if (completionStatus === 'succeeded') return 100;
  const job = workflow?.jobs?.find((item) => item.workflow_stage?.toLowerCase() === stage);
  if (typeof job?.progress === 'number' && Number.isFinite(job.progress)) {
    return Math.max(0, Math.min(100, Math.round(job.progress)));
  }
  const status = job?.status?.toLowerCase();
  if (status === 'succeeded' || status === 'completed' || status === 'success') return 100;
  if (status === 'running') return 50;
  return 0;
}

function clientSafeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '未知錯誤');
  return message
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/Authorization\s*:\s*[^\r\n]+/gi, 'Authorization: [REDACTED]')
    .slice(0, 500);
}

function formatLogTime(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString('zh-TW', { hour12: false });
}

export async function copyTextToClipboard(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the compatibility path for non-secure context / embedded / mobile browsers.
  }
  try {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const copied = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
      textarea.remove();
      return copied;
    }
  } catch {
    return false;
  }
  return false;
}

export default function Home() {
  const [copied, setCopied] = useState(false);
  const [errorCopied, setErrorCopied] = useState(false);
  const [dispatchMode, setDispatchMode] = useState<'test' | 'live'>('test');
  const [dispatchFlow, setDispatchFlow] = useState<'single' | 'loop'>('loop');
  const [noExternalWrite, setNoExternalWrite] = useState(true);
  const [taskText, setTaskText] = useState('');
  const [dispatchState, setDispatchState] = useState<DispatchState>('idle');
  const [dispatchJob, setDispatchJob] = useState('job-tg01-ready');
  const [dispatchCode, setDispatchCode] = useState('');
  const [workflowId, setWorkflowId] = useState(defaultWorkflowId);
  const [workflowState, setWorkflowState] = useState<WorkflowPayload | null>(null);
  const [dispatchProgress, setDispatchProgress] = useState<DispatchPhase[]>([]);
  const [dispatchSummary, setDispatchSummary] = useState('');
  const [lifecycleQuery, setLifecycleQuery] = useState<LifecycleQuery | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [copiedLogQuery, setCopiedLogQuery] = useState(false);
  const [bridgeHealth, setBridgeHealth] = useState<BridgeHealthState>('checking');
  const [websiteView, setWebsiteView] = useState<WebsiteView>('frontend');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncResultMsg, setSyncResultMsg] = useState<string>('同步本機網站至 GitHub，並產生 Sites handoff');
  const isLocalhost = useSyncExternalStore(subscribeToLocation, getIsLocalhost, () => true);
  const pollingToken = useRef(0);
  const logCloseButtonRef = useRef<HTMLButtonElement>(null);
  const syncResetTimer = useRef<number | null>(null);

  const effectiveSyncStatus: SyncStatus = !isLocalhost ? 'local-only' : syncStatus;
  const effectiveSyncMsg: string = !isLocalhost ? '僅支援本機執行 (127.0.0.1 / localhost)' : syncResultMsg;

  const bridgeLabel = bridgeHealth === 'connected'
    ? 'API linked'
    : bridgeHealth === 'checking'
      ? '檢查中'
      : bridgeHealth === 'offline'
        ? '不可達'
        : '待連線';

  const recordClientLog = (input: {
    job_id?: string;
    workflow_id?: string;
    stage: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked';
    level: 'info' | 'warn' | 'error';
    source: 'control-plane';
    message: string;
    detail?: string;
  }) => {
    void fetch('/control-api/logs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...input,
        message: clientSafeErrorMessage(input.message),
        detail: input.detail ? clientSafeErrorMessage(input.detail) : undefined,
      }),
      keepalive: true,
    }).catch(() => undefined);
  };

  const refreshBridgeHealth = async () => {
    try {
      const response = await fetch('/api/tg/health', { cache: 'no-store' });
      const payload = await response.json() as { ok?: boolean; bridgeConfigured?: boolean; bridgeConnected?: boolean };
      if (payload.ok && payload.bridgeConnected) {
        setBridgeHealth('connected');
      } else if (payload.ok && !payload.bridgeConfigured) {
        setBridgeHealth('pending');
      } else {
        setBridgeHealth('offline');
      }
      return payload;
    } catch (error) {
      setBridgeHealth('offline');
      recordClientLog({
        stage: 'telegram',
        status: 'failed',
        level: 'error',
        source: 'control-plane',
        message: '無法讀取 health API',
        detail: clientSafeErrorMessage(error),
      });
      return { ok: false, bridgeConfigured: false, bridgeConnected: false };
    }
  };

  useEffect(() => {
    let active = true;
    fetch('/api/tg/health', { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ ok?: boolean; bridgeConfigured?: boolean; bridgeConnected?: boolean }>)
      .then((payload) => {
        if (!active) return;
        if (payload.ok && payload.bridgeConnected) {
          setBridgeHealth('connected');
        } else if (payload.ok && !payload.bridgeConfigured) {
          setBridgeHealth('pending');
        } else {
          setBridgeHealth('offline');
        }
      })
      .catch((error) => {
        if (active) setBridgeHealth('offline');
        recordClientLog({
          stage: 'telegram',
          status: 'failed',
          level: 'error',
          source: 'control-plane',
          message: '無法讀取 health API',
          detail: clientSafeErrorMessage(error),
        });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isLocalhost) return;

    let active = true;

    fetch('http://127.0.0.1:4319/status', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<{ ok?: boolean; busy?: boolean; status?: string }>;
      })
      .then((data) => {
        if (!active) return;
        if (data.ok && (data.busy || data.status === 'busy')) {
          setSyncStatus('syncing');
          setSyncResultMsg('同步服務正在執行中');
        } else {
          setSyncStatus('idle');
          setSyncResultMsg('同步服務已就緒 (點擊同步)');
        }
      })
      .catch((error) => {
        if (!active) return;
        // If helper unavailable on localhost, keep button enabled enough to retry or show 同步失敗 after click; do not crash.
        setSyncStatus('idle');
        setSyncResultMsg(`同步服務未連線 (${clientSafeErrorMessage(error)})，點擊可重試`);
      });

    return () => {
      active = false;
      if (syncResetTimer.current) {
        window.clearTimeout(syncResetTimer.current);
      }
    };
  }, [isLocalhost]);

  const handleSync = async () => {
    if (!isLocalhost || effectiveSyncStatus === 'syncing' || effectiveSyncStatus === 'local-only') {
      return;
    }
    if (syncResetTimer.current) {
      window.clearTimeout(syncResetTimer.current);
      syncResetTimer.current = null;
    }
    setSyncStatus('syncing');
    setSyncResultMsg('正在同步本機網站至 GitHub，並產生 Sites handoff...');
    try {
      // POST /sync with no body and no arbitrary input
      const response = await fetch('http://127.0.0.1:4319/sync', {
        method: 'POST',
      });
      const payload = await response.json().catch(() => null) as {
        ok?: boolean;
        status?: string;
        error?: string;
        output?: string;
      } | null;

      if (response.ok && payload && (payload.ok || payload.status === 'success')) {
        setSyncStatus('success');
        setSyncResultMsg('已同步成功');
        syncResetTimer.current = window.setTimeout(() => {
          setSyncStatus('idle');
          setSyncResultMsg('同步服務已就緒 (點擊同步)');
        }, 3000);
      } else {
        const errorDetail = payload?.error || (payload?.output ? payload.output.trim().split('\n').pop() : `HTTP ${response.status}`);
        const safeErr = clientSafeErrorMessage(errorDetail || '同步失敗');
        setSyncStatus('error');
        setSyncResultMsg(`同步失敗: ${safeErr}`);
        syncResetTimer.current = window.setTimeout(() => {
          setSyncStatus('idle');
          setSyncResultMsg('同步服務已就緒 (點擊可重試)');
        }, 4000);
      }
    } catch (error) {
      const safeErr = clientSafeErrorMessage(error);
      setSyncStatus('error');
      setSyncResultMsg(`同步失敗: ${safeErr}`);
      syncResetTimer.current = window.setTimeout(() => {
        setSyncStatus('idle');
        setSyncResultMsg('同步服務未連線，點擊可重試');
      }, 4000);
    }
  };

  useEffect(() => {
    if (!lifecycleQuery) return;
    logCloseButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLifecycleQuery(null);
        setExpandedLogId(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [lifecycleQuery]);

  const copyCommand = async () => {
    try {
      if (await copyTextToClipboard(command)) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      } else {
        setCopied(false);
      }
    } catch {
      setCopied(false);
    }
  };

  const copyWorkflowError = async () => {
    const query = workflowId ? `/workflow ${workflowId}` : '/workflow <flow_id>';
    const errorText = `E500 workflow error\n${dispatchSummary}\n查詢命令：${query}`;
    try {
      if (await copyTextToClipboard(errorText)) {
        setErrorCopied(true);
        window.setTimeout(() => setErrorCopied(false), 1800);
      } else {
        setErrorCopied(false);
      }
    } catch {
      setErrorCopied(false);
    }
  };

  const copyLogQuery = async () => {
    const query = lifecycleQuery?.queryCommand;
    if (!query) return;
    try {
      if (await copyTextToClipboard(query)) {
        setCopiedLogQuery(true);
        window.setTimeout(() => setCopiedLogQuery(false), 1800);
      } else {
        setCopiedLogQuery(false);
      }
    } catch {
      setCopiedLogQuery(false);
    }
  };

  const pollJob = async (jobId: string, token: number) => {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (pollingToken.current !== token) return;
      if (attempt > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }

      try {
        const response = await fetch(`/api/tg/result/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
        const payload = await response.json() as { ok?: boolean; job?: JobPayload };
        if (!response.ok || !payload.ok || !payload.job?.status) throw new Error('job result unavailable');
        if (pollingToken.current !== token) return;

        if (payload.job.status === 'queued') {
          setDispatchState('queued');
          setDispatchProgress(['queued']);
          setDispatchSummary('任務已進入 queue，等待 Codex worker 接手。');
          continue;
        }
        if (payload.job.status === 'running') {
          setDispatchState('running');
          setDispatchProgress(['queued', 'running']);
          setDispatchSummary('Codex 正在讀取 workspace、修改程式並執行測試。');
          continue;
        }
        if (payload.job.status === 'succeeded') {
          setDispatchState('completed');
          setDispatchProgress(['queued', 'running', 'completed']);
          setDispatchSummary(payload.job.report?.summary || 'Codex job completed。');
          return;
        }
        if (payload.job.status === 'failed') {
          setDispatchState('failed');
          setDispatchProgress(['queued', 'running', 'failed']);
          setDispatchSummary(payload.job.report?.summary || payload.job.error || 'Codex job failed。');
          return;
        }
      } catch (error) {
        if (pollingToken.current !== token) return;
        setDispatchState('failed');
        setDispatchProgress(['queued', 'failed']);
        setDispatchSummary('無法讀取 job 結果，請稍後使用 /result 查詢。');
        recordClientLog({
          job_id: jobId,
          stage: 'codex',
          status: 'failed',
          level: 'error',
          source: 'control-plane',
          message: '無法讀取 job 結果',
          detail: clientSafeErrorMessage(error),
        });
        return;
      }
    }

    if (pollingToken.current === token) {
      setDispatchState('failed');
      setDispatchProgress(['queued', 'failed']);
      setDispatchSummary('等待 job 結果逾時，請使用 /result 查詢。');
    }
  };

  const pollWorkflow = async (flowId: string, token: number) => {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (pollingToken.current !== token) return;
      if (attempt > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }

      try {
        const response = await fetch(`/api/tg/workflow/${encodeURIComponent(flowId)}`, { cache: 'no-store' });
        const payload = await response.json() as { ok?: boolean; error?: string; workflow?: WorkflowPayload };
        if (!response.ok || !payload.ok || !payload.workflow?.status) {
          throw new Error(payload.error || payload.workflow?.error || `HTTP ${response.status}`);
        }
        if (pollingToken.current !== token) return;
        const workflow = payload.workflow;
        setWorkflowState(workflow);
        if (workflow.status === 'succeeded') {
          setDispatchState('completed');
          setDispatchProgress(['queued', 'running', 'completed']);
          setDispatchSummary(`GPT → AGY → Claude 已完成，GitHub 報告：${workflow.github_url || workflow.github_status || '已處理'}`);
          return;
        }
        if (workflow.status === 'failed') {
          setDispatchState('failed');
          setDispatchProgress(['queued', 'running', 'failed']);
          setDispatchSummary(workflow.error || `${workflow.current_stage || 'workflow'} stage failed。`);
          return;
        }
        setDispatchState(workflow.status === 'queued' ? 'queued' : 'running');
        setDispatchProgress(['queued', 'running']);
        const stage = workflow.current_stage?.toUpperCase() || 'GPT';
        setDispatchSummary(`${stage} stage 進行中；完成後自動接續下一階段。`);
      } catch (error) {
        if (pollingToken.current !== token) return;
        setDispatchState('failed');
        setDispatchProgress(['queued', 'failed']);
        const detail = clientSafeErrorMessage(error);
        const failureMessage = `無法讀取 workflow 結果：${detail}`;
        recordClientLog({
          workflow_id: flowId,
          stage: 'workflow',
          status: 'failed',
          level: 'error',
          source: 'control-plane',
          message: failureMessage,
          detail: `flow_id=${flowId}; query=/workflow ${flowId}`,
        });
        setWorkflowState((current) => {
          const stage = workflowStages.some((item) => item.key === current?.current_stage?.toLowerCase())
            ? current?.current_stage?.toLowerCase() as WorkflowStage
            : 'gpt';
          const jobs = current?.jobs?.map((job) => job.workflow_stage?.toLowerCase() === stage
            ? { ...job, status: 'failed' }
            : job) ?? [{ workflow_stage: stage, status: 'failed' }];
          return { ...current, status: 'failed', current_stage: stage, error: failureMessage, jobs };
        });
        setDispatchSummary(`${failureMessage}。請使用 /workflow ${flowId} 查詢。`);
        return;
      }
    }

    if (pollingToken.current === token) {
      setDispatchState('failed');
      setDispatchProgress(['queued', 'failed']);
      const failureMessage = `等待 workflow 結果逾時，請使用 /workflow ${flowId} 查詢。`;
      recordClientLog({
        workflow_id: flowId,
        stage: 'workflow',
        status: 'failed',
        level: 'error',
        source: 'control-plane',
        message: '等待 workflow 結果逾時',
        detail: `flow_id=${flowId}; query=/workflow ${flowId}`,
      });
      setWorkflowState((current) => {
        const stage = workflowStages.some((item) => item.key === current?.current_stage?.toLowerCase())
          ? current?.current_stage?.toLowerCase() as WorkflowStage
          : 'gpt';
        const jobs = current?.jobs?.map((job) => job.workflow_stage?.toLowerCase() === stage
          ? { ...job, status: 'failed' }
          : job) ?? [{ workflow_stage: stage, status: 'failed' }];
        return { ...current, status: 'failed', current_stage: stage, error: failureMessage, jobs };
      });
      setDispatchSummary(failureMessage);
    }
  };

  const submitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!taskText.trim()) return;
    if (taskText.length > MAX_TASK_LENGTH) {
      setDispatchState('blocked');
      setDispatchCode('TASK_INVALID');
      setDispatchSummary(`任務不可超過 ${MAX_TASK_LENGTH.toLocaleString()} 字元。`);
      return;
    }
    const token = pollingToken.current + 1;
    pollingToken.current = token;
    setWorkflowId('');
    setWorkflowState(null);
    setErrorCopied(false);
    setDispatchCode('');
    setDispatchProgress([]);
    setDispatchSummary('');
    setLifecycleQuery(null);

    if (dispatchMode === 'live') {
      setDispatchState('checking');
      const health = await refreshBridgeHealth();
      if (!health.ok) {
        setDispatchState('blocked');
        return;
      }
      if (!health.bridgeConfigured) {
        setDispatchState('verified');
        return;
      }
      if (!health.bridgeConnected) {
        setDispatchState('blocked');
        return;
      }
      try {
        const endpoint = dispatchFlow === 'loop' ? '/api/tg/workflow' : '/api/tg/run';
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            task: taskText,
            mode: 'write',
            provider: 'codex',
            // This is intentionally explicit: native bridge persistence, not
            // the UI, enforces the final no-external-write policy.
            noExternalWrite: dispatchFlow === 'loop' && noExternalWrite,
          }),
        });
        const payload = await response.json() as {
          ok?: boolean;
          code?: string;
          message?: string;
          job?: { id?: string };
          workflow?: WorkflowPayload & { id?: string };
          running_jobs?: JobPayload[];
        };
        if (!response.ok || !payload.ok || !payload.job?.id) {
          const running = payload.running_jobs?.[0];
          setDispatchState('blocked');
          setDispatchCode(payload.code || 'BRIDGE_UNAVAILABLE');
          setDispatchProgress(['queued', 'failed']);
          if (payload.code === 'CODEX_EXEC_RUNNING' && running?.id) {
            setDispatchJob(running.id);
            setDispatchSummary(`${payload.message || '已有 Codex exec 正在執行。'} running job=${running.id}，workflow=${running.workflow_id || 'standalone'}，stage=${running.workflow_stage || 'gpt'}。請先評估目前任務，再重新執行 /gpt。`);
          } else {
            setDispatchSummary(payload.message || 'Bridge API 無法派送 workflow。');
          }
          return;
        }
        setDispatchJob(payload.job.id);
        setDispatchState('queued');
        setDispatchProgress(['queued']);
        if (dispatchFlow === 'loop' && payload.workflow?.id) {
          setWorkflowId(payload.workflow.id);
          setWorkflowState(payload.workflow);
          setDispatchSummary('GPT stage 已進入 queue，完成後自動接 AGY、Claude 與 GitHub 報告。');
          void pollWorkflow(payload.workflow.id, token);
        } else {
          setDispatchSummary('任務已進入 queue，等待 Codex worker 接手。');
          void pollJob(payload.job.id, token);
        }
      } catch (error) {
        setDispatchState('blocked');
        recordClientLog({
          stage: dispatchFlow === 'loop' ? 'workflow' : 'codex',
          status: 'failed',
          level: 'error',
          source: 'control-plane',
          message: 'Live dispatch request failed',
          detail: clientSafeErrorMessage(error),
        });
      }
      return;
    }

    setDispatchJob('job-demo-tg01');
    setDispatchState('queued');
    setDispatchProgress(['queued']);
    setDispatchSummary(dispatchFlow === 'loop'
      ? '測試模式只模擬 GPT → AGY → Claude queue，不會呼叫 Codex Bridge。'
      : '測試模式只模擬 queue，不會呼叫 Codex Bridge。');
  };

  const queryLifecycle = async (key: LifecycleKey, stageOverride?: string) => {
    const card = lifecycle.find((item) => item.key === key);
    const stage = stageOverride || card?.stage || 'workflow';
    setExpandedLogId(null);
    setCopiedLogQuery(false);
    setLifecycleQuery({ key, stage, loading: true, logs: [], message: '正在讀取 SQLite execution log…' });
    try {
      const scope = workflowId ? 'workflow' : (dispatchMode === 'live' && dispatchJob && dispatchJob !== 'job-tg01-ready' ? 'job' : null);
      const id = workflowId || (scope === 'job' ? dispatchJob : '');
      const queryCommand = scope === 'workflow' && id ? `/workflow ${id}` : scope === 'job' && id ? `/result ${id}` : undefined;
      if (!scope || !id) {
        setLifecycleQuery({
          key,
          stage,
          loading: false,
          logs: [],
          queryCommand,
          message: dispatchMode === 'test'
            ? `測試模式沒有 SQLite execution log；請切換實際派送後查詢 ${card?.label || key}。`
            : '尚未建立可查詢的 job_id 或 workflow_id。',
        });
        return;
      }
      const queryUrl = `/control-api/logs?${scope === 'workflow' ? 'workflow_id' : 'job_id'}=${encodeURIComponent(id)}&stage=${encodeURIComponent(stage)}&limit=100`;
      const response = await fetch(queryUrl, { cache: 'no-store' });
      const payload = await response.json() as { ok?: boolean; error?: string; logs?: ExecutionLogRecord[]; scope?: 'workflow' | 'job' };
      if (!response.ok || !payload.ok || !Array.isArray(payload.logs)) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setLifecycleQuery({
        key,
        stage,
        loading: false,
        logs: payload.logs,
        scope: payload.scope,
        queryCommand,
        message: payload.logs.length ? undefined : `目前沒有 ${card?.label || key} 的紀錄。`,
      });
    } catch (error) {
      const message = clientSafeErrorMessage(error);
      recordClientLog({
        job_id: workflowId ? undefined : (dispatchJob !== 'job-tg01-ready' ? dispatchJob : undefined),
        workflow_id: workflowId || undefined,
        stage,
        status: 'failed',
        level: 'error',
        source: 'control-plane',
        message: `無法讀取 ${card?.label || key} LOG：${message}`,
        detail: workflowId ? `workflow_id=${workflowId}` : `job_id=${dispatchJob}`,
      });
      setLifecycleQuery({
        key,
        stage,
        loading: false,
        logs: [],
        scope: workflowId ? 'workflow' : 'job',
        queryCommand: workflowId ? `/workflow ${workflowId}` : `/result ${dispatchJob}`,
        error: true,
        offline: true,
        offlineMessage: message,
        message: 'LOG API OFFLINE',
      });
    }
  };

  const activateLogButton = (event: ReactKeyboardEvent<HTMLButtonElement>, key: LifecycleKey, stage: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void queryLifecycle(key, stage);
    }
  };

  const startWebsiteDesign = () => {
    setDispatchFlow('loop');
    setDispatchMode('test');
    setTaskText('設計一個可預覽的網站，完成後提供前台與後台畫面，並回報 build 結果。');
    setDispatchState('idle');
    setWorkflowId('');
    setWorkflowState(null);
    window.document.getElementById('tg-command')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className="site-shell">
      <div className="noise" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="E500 Control Plane 首頁">
          <span className="brand-mark"><span /></span>
          <span>E500 <em>/</em> CONTROL PLANE</span>
        </a>
        <nav className="nav-links" aria-label="主要導覽">
          <a href="#tg-command">程設</a>
          <a href="#websites">網站</a>
          <a href="#architecture">架構</a>
          <a href="#lifecycle">生命週期</a>
          <a href="#commands">指令</a>
          <a href="#safety">安全閘</a>
        </nav>
        <div className="topbar-actions">
          <button
            type="button"
            className={`topbar-sync-button ${effectiveSyncStatus}`}
            onClick={handleSync}
            disabled={effectiveSyncStatus === 'local-only' || effectiveSyncStatus === 'syncing'}
            title={effectiveSyncMsg}
            aria-label={`網站同步 (${syncButtonLabels[effectiveSyncStatus]})`}
          >
            <span className="sync-indicator" aria-hidden="true" />
            <span>{syncButtonLabels[effectiveSyncStatus]}</span>
          </button>
          <span className="topbar-link" title="在 ChatGPT/Sites 使用 E500 更新 userscript；本頁不會直接寫入 Sites">
            Sites：userscript
          </span>
          <span className="sr-only" aria-live="polite" role="status">
            {effectiveSyncMsg}
          </span>
          <a className="topbar-link" href="https://github.com/b827262-cell/Telegram-ai-code" target="_blank" rel="noreferrer">
            GitHub <span>↗</span>
          </a>
        </div>
      </header>

      <section className="hero section-wrap" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="status-dot" /> TG-CODEX-CONTROL-001 <span className="eyebrow-rule" /> PHASE 01</div>
          <h1>Telegram Task<br /><span>Codex Antigravity Claude</span></h1>
          <p className="hero-lede">把 Telegram 做成 control plane，而不是另一個 IDE。你只需要下指令；job lifecycle、repo context、測試與 Git safety 交給 Codex。</p>
          <div className="hero-actions">
            <a className="button button-primary" href="#lifecycle">查看任務生命週期 <span>↓</span></a>
            <a className="button button-quiet" href="https://github.com/b827262-cell/Telegram-ai-code" target="_blank" rel="noreferrer">開啟 GitHub <span>↗</span></a>
          </div>
          <div className="hero-note"><span className="note-line" /> 預設 provider <strong>codex</strong> · 不使用瀏覽器自動化</div>
        </div>

        <div className="terminal-card" aria-label="Telegram 指令預覽">
          <div className="terminal-top"><span className="terminal-lights"><i /><i /><i /></span><span>telegram-controller / live</span><span className="terminal-live"><b /> LIVE</span></div>
          <div className="terminal-body">
            <div className="terminal-line muted"><span>01</span><span># send a task from anywhere</span></div>
            <div className="terminal-line"><span>02</span><strong className="green-text">$</strong><span className="white-text"> /run 修正 worker timeout lock cleanup</span></div>
            <div className="terminal-line muted"><span>03</span><span>  完成後執行 pytest，不要 push。</span></div>
            <div className="terminal-divider" />
            <div className="terminal-line"><span>07</span><strong className="violet-text">BOT</strong><span className="white-text"> Codex job queued</span></div>
            <div className="terminal-line"><span>08</span><span className="muted">  job:</span><span className="green-text"> job-a81c...</span></div>
            <div className="terminal-line"><span>09</span><span className="muted">  provider:</span><span className="blue-text"> codex</span></div>
            <div className="terminal-line"><span>10</span><span className="muted">  mode:</span><span className="white-text"> workspace-write</span></div>
            <div className="terminal-cursor"><span>11</span><span className="cursor-line" /></div>
          </div>
          <div className="terminal-foot"><span><b className="green-dot" /> queue healthy</span><span>Asia/Taipei · 13:37:08</span></div>
        </div>
      </section>

      <section className="signal-strip section-wrap" aria-label="系統摘要">
        <div><strong>01</strong><span>主 provider</span><b>codex</b></div>
        <div><strong>04</strong><span>job states</span><b>tracked</b></div>
        <div><strong>00</strong><span>browser automation</span><b>needed</b></div>
        <div><strong>100%</strong><span>Git safety</span><b>preserved</b></div>
      </section>

      <section className="tg-command section-wrap" id="tg-command">
        <div className="tg-command-copy">
          <p className="section-kicker">TG 01 / LIVE COMMAND SURFACE</p>
          <h2>從這裡，<br /><span>把命令交給 Codex。</span></h2>
          <p className="panel-lede">這是 Telegram → Codex 的實際下達命令區。先用測試模式確認 payload 與回應，再開啟實際派送。</p>
          <div className="credential-grid" aria-label="TG 01 連線需求">
            <div className="credential-chip"><i className="chip-ready" /><span>BOT TOKEN</span><strong>Sites Secret</strong></div>
            <div className="credential-chip"><i className="chip-ready" /><span>CHAT ID</span><strong>allowlist</strong></div>
            <div className="credential-chip"><i className={bridgeHealth === 'connected' ? 'chip-ready' : 'chip-pending'} /><span>CODEX BRIDGE</span><strong>{bridgeLabel}</strong></div>
          </div>
          <p className="tg-safety-note"><span>⌁</span> Token 不放進前端，也不用貼在聊天裡；正式連線時只會讀取 Sites 的私密設定。</p>
        </div>

        <div className="tg-console">
          <div className="console-top"><span className="console-label"><b /> TG 01 / COMMAND CONSOLE</span><span className={`console-mode ${dispatchMode}`}>{dispatchMode === 'test' ? 'TEST MODE' : 'LIVE MODE'}</span></div>
          <form onSubmit={submitTask}>
            <label className="console-label-text" htmlFor="tg-task">COMMAND PAYLOAD <span>/{dispatchFlow === 'loop' ? 'gpt' : 'run'}</span></label>
            <div className="task-field"><span>/{dispatchFlow === 'loop' ? 'gpt' : 'run'}</span><textarea id="tg-task" value={taskText} maxLength={MAX_TASK_LENGTH} onChange={(event) => { setTaskText(event.target.value); setDispatchState('idle'); setWorkflowId(''); setWorkflowState(null); setErrorCopied(false); setDispatchCode(''); }} rows={4} aria-describedby="tg-task-help" /></div>
            <p className="console-help" id="tg-task-help">{dispatchFlow === 'loop' ? <>依序排程 <strong>Codex → AGY → Claude</strong>；live smoke 預設不寫入 GitHub，可明確關閉此安全模式以保留正常報告。 </> : <>會送往預設 provider <strong>codex</strong>，並保留 workspace-write / no-push 邊界。 </>}<span className="task-counter" aria-live="polite">{taskText.length.toLocaleString()} / {MAX_TASK_LENGTH.toLocaleString()} 字元</span></p>
            <div className="console-controls">
              <div className="flow-switch mode-switch" aria-label="工作流程">
                <button className={dispatchFlow === 'single' ? 'selected' : ''} onClick={() => setDispatchFlow('single')} type="button">單一 /run</button>
                <button className={dispatchFlow === 'loop' ? 'selected live' : ''} onClick={() => setDispatchFlow('loop')} type="button">GPT LOOP /gpt</button>
              </div>
              <div className="mode-switch" aria-label="派送模式">
                <button className={dispatchMode === 'test' ? 'selected' : ''} onClick={() => setDispatchMode('test')} type="button">測試佇列</button>
                <button className={dispatchMode === 'live' ? 'selected live' : ''} onClick={() => setDispatchMode('live')} type="button">實際派送</button>
              </div>
              {dispatchFlow === 'loop' && <label className="console-label-text"><input checked={noExternalWrite} onChange={(event) => setNoExternalWrite(event.target.checked)} type="checkbox" /> 無外部寫入（smoke）</label>}
              <button className="send-button" disabled={dispatchState === 'checking'} type="submit">{dispatchMode === 'test' ? '送出測試命令' : '實際派送'} <span>↗</span></button>
            </div>
          </form>
          <div className={`dispatch-result ${dispatchState}`} role="status" aria-live="polite">
            {dispatchState === 'idle' && <><span className="result-icon">○</span><span>Ready / 等待命令</span><code>POST /tg/run</code></>}
            {dispatchState === 'queued' && <><span className="result-icon result-ok">✓</span><span><strong>{workflowId ? 'Workflow queued' : 'Codex job queued'}</strong> / {dispatchMode === 'live' ? 'API 實際派送' : '測試回應'}</span><code>{workflowId || dispatchJob}</code></>}
            {dispatchState === 'running' && <><span className="result-icon result-running">◌</span><span><strong>{workflowId ? 'Workflow running' : 'Codex job running'}</strong> / 正在執行任務</span><code>{workflowId || dispatchJob}</code></>}
            {dispatchState === 'completed' && <><span className="result-icon result-ok">✓</span><span><strong>{workflowId ? 'Workflow completed' : 'Codex job completed'}</strong> / 已完成</span><code>{workflowId || dispatchJob}</code></>}
            {dispatchState === 'failed' && <><span className="result-icon result-warn">!</span><span><strong>{workflowId ? 'Workflow failed' : 'Codex job failed'}</strong> / 執行失敗</span><code>{workflowId || dispatchJob}</code></>}
            {dispatchState === 'checking' && <><span className="result-icon result-checking">◌</span><span><strong>Checking Telegram Bot</strong> / 正在驗證 Bridge API</span><code>GET /api/tg/health</code></>}
            {dispatchState === 'verified' && <><span className="result-icon result-ok">✓</span><span><strong>Telegram Bot verified</strong> / Codex bridge 尚未設定</span><code>BRIDGE_REQUIRED</code></>}
            {dispatchState === 'blocked' && <><span className="result-icon result-warn">!</span><span><strong>{dispatchCode === 'CODEX_EXEC_RUNNING' ? 'Codex exec already running' : 'Live dispatch blocked'}</strong> / {dispatchCode === 'CODEX_EXEC_RUNNING' ? '請先評估執行中任務' : 'Bridge API 無法連線'}</span><code>{dispatchCode || 'BRIDGE_UNAVAILABLE'}</code></>}
          </div>
          {dispatchProgress.length > 0 && <div className="dispatch-progress" aria-label="Codex job progress">
            <div className="progress-track">
              {(['queued', 'running', dispatchProgress.includes('failed') ? 'failed' : 'completed'] as DispatchPhase[]).map((phase, index) => {
                const active = dispatchProgress.includes(phase);
                const label = phase === 'queued' ? 'QUEUED' : phase === 'running' ? 'RUNNING' : phase === 'failed' ? 'FAILED' : 'COMPLETED';
                return <span className={`progress-step ${active ? 'active' : ''} ${phase === dispatchState ? 'current' : ''}`} key={phase}><i>{String(index + 1).padStart(2, '0')}</i>{label}</span>;
              })}
            </div>
            {dispatchSummary && <div className="dispatch-summary"><p>{dispatchSummary}</p>{dispatchState === 'failed' && workflowId && <div className="workflow-error-actions"><code>/workflow {workflowId}</code><button className="copy-error-button" onClick={copyWorkflowError} type="button"><span>{errorCopied ? '✓' : '⧉'}</span>{errorCopied ? '已複製錯誤訊息' : '複製錯誤訊息'}</button></div>}</div>}
          </div>}
          {workflowId && workflowState && <div className="workflow-lights" aria-label="GPT AGY Claude 三燈管制">
            <div className="workflow-lights-head">
              <span>PIPELINE LIGHTS / 三燈管制</span>
              <span className="workflow-legend">
                <span><i className="traffic-key red" />失敗</span>
                <span><i className="traffic-key progress" />進行中</span>
                <span><i className="traffic-key green" />通過</span>
              </span>
            </div>
            <div className="workflow-lights-grid">
              {workflowStages.map((stage) => {
                const light = getWorkflowLight(workflowState, stage.key);
                const progress = getWorkflowProgress(workflowState, stage.key);
                return <div className="workflow-light-card" key={stage.key}>
                  <span className={`traffic-light ${light}`} aria-label={`${stage.label}：${workflowLightLabels[light]}`}><i /></span>
                  <span className="workflow-light-content"><span className="workflow-light-title"><strong>{stage.label}</strong><small>{workflowLightLabels[light]}</small></span><span className="workflow-progress-row" aria-label={`${stage.label} 完成度 ${progress}%`}><span className="workflow-progress-track"><span style={{ width: `${progress}%` }} /></span><em>{progress}%</em></span></span>
                </div>;
              })}
            </div>
            <div className={`workflow-completion-strip ${getPipelineNodeState(workflowState, 'report')}`} aria-label={`回報完成度 ${getWorkflowCompletion(workflowState)}%`}>
              <span className="completion-box">06</span>
              <span className="workflow-light-content"><span className="workflow-light-title"><strong>REPORT / COMPLETION</strong><small>{workflowState.status === 'succeeded' ? '通過' : workflowState.status === 'failed' ? '失敗' : '進度回報'}</small></span><span className="workflow-progress-row"><span className="workflow-progress-track"><span style={{ width: `${getWorkflowCompletion(workflowState)}%` }} /></span><em>{getWorkflowCompletion(workflowState)}%</em></span></span>
            </div>
          </div>}
        </div>
      </section>

      <section className="website-studio section-wrap" id="websites">
        <div className="section-heading">
          <div><p className="section-kicker">05 / WEBSITE STUDIO</p><h2>用 /gpt 設計，<br /><span>前台與後台都在這裡。</span></h2></div>
          <p>網站完成後，不需要離開控制台。直接切換 customer-facing 前台、admin 後台與 API contract，從同一個 workflow 追蹤產物。</p>
        </div>
        <div className="website-toolbar">
          <div className="website-tabs" role="tablist" aria-label="網站預覽切換">
            <button className={websiteView === 'frontend' ? 'selected' : ''} onClick={() => setWebsiteView('frontend')} type="button" role="tab" aria-selected={websiteView === 'frontend'}>前台 / Frontend</button>
            <button className={websiteView === 'backend' ? 'selected' : ''} onClick={() => setWebsiteView('backend')} type="button" role="tab" aria-selected={websiteView === 'backend'}>後台 / Backend</button>
          </div>
          <button className="website-action" onClick={startWebsiteDesign} type="button">＋ 使用 /gpt 建立網站 <span>↗</span></button>
        </div>
        <div className={`website-frame website-${websiteView}`}>
          <div className="website-frame-top"><span className="frame-dots"><i /><i /><i /></span><code>preview.telegram-ai-code / {websiteView === 'frontend' ? 'home' : 'admin'}</code><span className="frame-live">LIVE PREVIEW</span></div>
          {websiteView === 'frontend' ? (
            <div className="website-frontend-preview">
              <div className="preview-nav"><strong>NORTHSTAR</strong><span>Workflows</span><span>Agents</span><span>Docs</span><button type="button">Launch console ↗</button></div>
              <div className="preview-hero"><span className="preview-kicker">SHIP WITH CLARITY</span><h3>From task to <em>working software.</em></h3><p>A calm workspace for directing coding agents, reviewing progress, and publishing with confidence.</p><div className="preview-cta"><button type="button">Start a workflow</button><span>See how it works →</span></div></div>
              <div className="preview-stats"><div><strong>04</strong><span>agents ready</span></div><div><strong>99.2%</strong><span>build reliability</span></div><div><strong>24/7</strong><span>runtime visibility</span></div></div>
            </div>
          ) : (
            <div className="website-backend-preview">
              <aside className="preview-admin-nav"><strong>NORTHSTAR</strong><span className="active">Overview</span><span>Projects</span><span>Deployments</span><span>Team access</span><span>Settings</span></aside>
              <div className="preview-admin-main"><div className="admin-heading"><div><span className="preview-kicker">SITE ADMIN</span><h3>Operations overview</h3></div><button type="button">＋ New deployment</button></div><div className="admin-metrics"><div><span>Published</span><strong>12</strong><small>↑ 18% this month</small></div><div><span>Build time</span><strong>42s</strong><small>↓ 8s from last run</small></div><div><span>API health</span><strong>99.9%</strong><small>All systems normal</small></div></div><div className="admin-activity"><div className="activity-head"><span>Recent activity</span><span>Status</span></div><div><span><strong>Website preview</strong><small>Generated by /gpt · 2 min ago</small></span><b className="admin-status good">Published</b></div><div><span><strong>Admin route</strong><small>Backend contract · 8 min ago</small></span><b className="admin-status progress">Building</b></div><div><span><strong>API routes</strong><small>/api/site · 12 min ago</small></span><b className="admin-status good">Healthy</b></div></div></div>
            </div>
          )}
        </div>
        <div className="website-contract" aria-label="網站輸出 contract">
          <div><span>Frontend route</span><code>/</code><small>Customer-facing pages and public assets</small></div>
          <div><span>Backend route</span><code>/admin</code><small>Content, deploy and runtime controls</small></div>
          <div><span>API contract</span><code>/api/*</code><small>Same-origin BFF to generated services</small></div>
        </div>
      </section>

      <section className="architecture section-wrap" id="architecture">
        <div className="section-heading">
          <div><p className="section-kicker">01 / SYSTEM MAP</p><h2>一條清楚的主線，<br />把複雜度留在幕後。</h2></div>
          <p>loop 會依序通過 GPT → AGY → Claude，最後回報完成度與 GitHub 報告；每個階段都能看見目前進度。</p>
        </div>
        <div className="pipeline" aria-label="Telegram、Controller、GPT、AGY、Claude 到回報完成度的任務流程">
          <div className={`pipeline-node telegram ${getPipelineNodeState(workflowState, 'telegram')}`}><span className="node-index">01</span><span className="node-icon">TG</span><strong>Telegram</strong><small>你的入口</small><button className="pipeline-log-query" aria-label="查詢 Telegram LOG" aria-controls="log-drawer" aria-expanded={lifecycleQuery?.stage === 'telegram'} onClick={() => void queryLifecycle('queued', 'telegram')} onKeyDown={(event) => activateLogButton(event, 'queued', 'telegram')} type="button">查詢 LOG</button></div><Arrow />
          <div className={`pipeline-node controller ${getPipelineNodeState(workflowState, 'controller')}`}><span className="node-index">02</span><span className="node-icon">◈</span><strong>Controller</strong><small>權限 · queue · job_id</small><button className="pipeline-log-query" aria-label="查詢 Controller LOG" aria-controls="log-drawer" aria-expanded={lifecycleQuery?.stage === 'controller'} onClick={() => void queryLifecycle('queued', 'controller')} onKeyDown={(event) => activateLogButton(event, 'queued', 'controller')} type="button">查詢 LOG</button></div><Arrow />
          <div className={`pipeline-node codex ${getPipelineNodeState(workflowState, 'gpt')}`}><span className="node-index">03</span><span className="node-icon">CX</span><strong>GPT / Codex</strong><small>repo · code · tests</small><button className="pipeline-log-query" aria-label="查詢 GPT Codex LOG" aria-controls="log-drawer" aria-expanded={lifecycleQuery?.stage === 'gpt'} onClick={() => void queryLifecycle('running', 'gpt')} onKeyDown={(event) => activateLogButton(event, 'running', 'gpt')} type="button">查詢 LOG</button></div><Arrow />
          <div className={`pipeline-node agy ${getPipelineNodeState(workflowState, 'agy')}`}><span className="node-index">04</span><span className="node-icon">AG</span><strong>AGY</strong><small>review · verify</small><button className="pipeline-log-query" aria-label="查詢 AGY LOG" aria-controls="log-drawer" aria-expanded={lifecycleQuery?.stage === 'agy'} onClick={() => void queryLifecycle('agy', 'agy')} onKeyDown={(event) => activateLogButton(event, 'agy', 'agy')} type="button">查詢 LOG</button></div><Arrow />
          <div className={`pipeline-node claude ${getPipelineNodeState(workflowState, 'claude')}`}><span className="node-index">05</span><span className="node-icon">CL</span><strong>Claude</strong><small>final · refine</small><button className="pipeline-log-query" aria-label="查詢 Claude LOG" aria-controls="log-drawer" aria-expanded={lifecycleQuery?.stage === 'claude'} onClick={() => void queryLifecycle('claude', 'claude')} onKeyDown={(event) => activateLogButton(event, 'claude', 'claude')} type="button">查詢 LOG</button></div><Arrow />
          <div className={`pipeline-node report ${getPipelineNodeState(workflowState, 'report')}`}><span className="node-index">06</span><span className="node-icon">↺</span><strong>回報完成度</strong><small>{workflowId ? `${getWorkflowCompletion(workflowState)}% · summary · GitHub` : 'summary · diff · status'}</small><button className="pipeline-log-query" aria-label="查詢回報完成度 LOG" aria-controls="log-drawer" aria-expanded={lifecycleQuery?.stage === 'report'} onClick={() => void queryLifecycle('succeeded', 'report')} onKeyDown={(event) => activateLogButton(event, 'succeeded', 'report')} type="button">查詢 LOG</button></div>
        </div>
        <div className="architecture-caption"><span className="caption-line" /><span>One source of truth</span><span className="caption-line caption-line-short" /><span className="muted-caption">所有狀態都能被查詢、取消、回看</span></div>
      </section>

      <section className="lifecycle section-wrap" id="lifecycle">
        <div className="section-heading split-heading">
          <div><p className="section-kicker">02 / JOB LIFECYCLE</p><h2>每一個 job，<br />都有來處與去處。</h2></div>
          <p>狀態不是黑盒。從排隊到完成，每個節點都能讓 Telegram 回報；失敗也留下可行動的下一步。</p>
        </div>
        <div className="lifecycle-grid">
          {lifecycle.map((item) => (
            <article className={`lifecycle-card ${item.color}`} key={item.key}>
              <div className="card-top"><span>{item.number}</span><span className="card-status"><i />{item.label}</span></div>
              <div className="card-signal" aria-hidden="true"><span /><span /><span /><span /><span /></div>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <div className="card-foot"><code>{item.stage}.log</code><button className="lifecycle-query-button" aria-label={`查詢 ${item.label} LOG`} aria-controls="log-drawer" aria-expanded={lifecycleQuery?.stage === item.stage} onClick={() => void queryLifecycle(item.key, item.stage)} onKeyDown={(event) => activateLogButton(event, item.key, item.stage)} type="button">查詢 LOG <span>↗</span></button></div>
            </article>
          ))}
        </div>
        {lifecycleQuery && <div className="log-drawer-layer">
          <button className="log-drawer-backdrop" aria-label="關閉 LOG drawer" onClick={() => setLifecycleQuery(null)} type="button" />
          <aside className={`log-drawer ${lifecycleQuery.error ? 'error' : ''}`} id="log-drawer" role="dialog" aria-modal="true" aria-labelledby="log-drawer-title">
            <div className="lifecycle-log-head"><div><p className="section-kicker">SQLITE LOG / {lifecycleQuery.stage.toUpperCase()}</p><strong id="log-drawer-title">{lifecycleQuery.loading ? '正在讀取 SQLite execution log…' : `查詢結果 · ${lifecycleQuery.scope || '未建立 scope'}`}</strong></div><button className="lifecycle-log-close" aria-label="關閉 LOG drawer" ref={logCloseButtonRef} onClick={() => setLifecycleQuery(null)} type="button">關閉 ×</button></div>
            {lifecycleQuery.offline ? <div className="log-offline" role="alert">
              <strong>LOG API OFFLINE</strong>
              <code>{lifecycleQuery.offlineMessage || 'Failed to fetch'}</code>
              <code>{lifecycleQuery.scope === 'workflow' ? `workflow_id=${workflowId}` : `job_id=${dispatchJob}`}</code>
              <div className="log-offline-actions"><button onClick={() => void queryLifecycle(lifecycleQuery.key, lifecycleQuery.stage)} type="button">重試</button><button onClick={() => void copyLogQuery()} type="button">{copiedLogQuery ? '已複製查詢命令' : '複製查詢命令'}</button></div>
            </div> : lifecycleQuery.message && <div className="lifecycle-log-message">{lifecycleQuery.message}</div>}
            <div className="execution-log-list">
              {lifecycleQuery.logs.map((log) => <article className={`execution-log-entry status-${log.status}`} key={log.id}>
                <button className="execution-log-summary" onClick={() => setExpandedLogId((current) => current === log.id ? null : log.id)} type="button" aria-expanded={expandedLogId === log.id}>
                  <span className="execution-log-status" data-level={log.level}>{log.status}</span>
                  <span className="execution-log-time">{formatLogTime(log.created_at)}</span>
                  <span className="execution-log-stage">{log.stage}</span>
                  <span className="execution-log-source">{log.source}</span>
                  <span className="execution-log-message">{log.message}</span>
                  <span className="execution-log-toggle" aria-hidden="true">{expandedLogId === log.id ? '−' : '+'}</span>
                </button>
                {expandedLogId === log.id && <div className="execution-log-detail">
                  <code>created_at={log.created_at}</code>
                  <code>stage={log.stage} status={log.status} level={log.level} source={log.source}</code>
                  <code>job_id={log.job_id || 'null'} workflow_id={log.workflow_id || 'null'}</code>
                  <p>{log.message}</p>
                  {log.detail && <pre>{log.detail}</pre>}
                </div>}
              </article>)}
            </div>
          </aside>
        </div>}
      </section>

      <section className="commands-safety section-wrap" id="commands">
        <div className="commands-panel">
          <p className="section-kicker">03 / TELEGRAM SURFACE</p>
          <h2>手機上的最小控制面。</h2>
          <p className="panel-lede">先把指令做少、做準。熟悉的入口，加上可預期的回應，就足夠啟動完整工程流程。</p>
          <div className="command-list">
            {commands.map(([name, description], index) => (
              <div className="command-row" key={name}><span className="command-number">0{index + 1}</span><code>{name}</code><span>{description}</span></div>
            ))}
          </div>
          <button className="copy-button" onClick={copyCommand} type="button"><span className="copy-icon">{copied ? '✓' : '＋'}</span>{copied ? '已複製範例指令' : '複製一個範例指令'}</button>
        </div>

        <div className="safety-panel" id="safety">
          <div className="safety-orbit orbit-one" /><div className="safety-orbit orbit-two" />
          <p className="section-kicker">04 / GIT SAFETY GATE</p>
          <h2>可自動化，<br /><span>不可失去控制。</span></h2>
          <p className="panel-lede">Codex 負責修改與測試；commit、push、approve 保留在你能看見的邊界裡。</p>
          <div className="safety-steps"><div><b>01</b><span>workspace check</span><i>✓</i></div><div><b>02</b><span>run tests</span><i>✓</i></div><div><b>03</b><span>human approve</span><i className="pending">○</i></div></div>
          <a className="text-link" href="https://github.com/b827262-cell/Telegram-ai-code" target="_blank" rel="noreferrer">查看專案邊界 <span>↗</span></a>
        </div>
      </section>

      <section className="next-phase section-wrap">
        <div><p className="section-kicker">NEXT / AFTER STABILITY</p><h2>等閉環穩定，<br />再讓系統長出更多手。</h2></div>
        <div className="future-stack"><div className="future-item active"><span>01</span><strong>Telegram → Codex</strong><small>現在 · 單一主線</small></div><div className="future-item"><span>02</span><strong>logs · approve · cancel</strong><small>下一步 · 控制加深</small></div><div className="future-item"><span>03</span><strong>Claude · Gemini · Integrator</strong><small>之後 · multi-agent</small></div></div>
      </section>

      <footer className="footer section-wrap"><div className="brand"><span className="brand-mark"><span /></span><span>E500 <em>/</em> CONTROL PLANE</span></div><span className="footer-copy">Built for calm, traceable delivery.</span><a href="#top" className="back-top">回到頂端 ↑</a></footer>
    </main>
  );
}
