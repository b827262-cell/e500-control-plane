'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

const command = '/run 修正 Telegram worker 的 timeout lock cleanup，完成後執行 pytest，不要 push。';

const lifecycle = [
  {
    key: 'queued',
    number: '01',
    label: 'QUEUED',
    title: '任務進入佇列',
    detail: 'Controller 建立 job_id，檢查 workspace 與 provider，回傳可追蹤的任務卡。',
    color: 'violet',
  },
  {
    key: 'running',
    number: '02',
    label: 'RUNNING',
    title: 'Codex 開始工作',
    detail: 'Dispatcher 將任務送往 Codex，在隔離環境裡讀 repo、改程式並執行測試。',
    color: 'blue',
  },
  {
    key: 'succeeded',
    number: '03',
    label: 'SUCCEEDED',
    title: '結果回到 Telegram',
    detail: 'Result Collector 整理摘要、changed files 與測試結果，讓你在手機上 review。',
    color: 'green',
  },
  {
    key: 'failed',
    number: '04',
    label: 'FAILED',
    title: '失敗也要可追蹤',
    detail: '保留錯誤、log 與 job 狀態；下一步可以 cancel、重試或人工介入。',
    color: 'red',
  },
];

const commands = [
  ['/ping', 'Bot / worker 健康檢查'],
  ['/run <task>', '預設送往 Codex'],
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
  workflow_stage?: string | null;
  status?: string;
  progress?: number | null;
};

type WorkflowPayload = {
  status?: string;
  current_stage?: string;
  github_url?: string | null;
  github_status?: string | null;
  error?: string | null;
  jobs?: WorkflowJobPayload[];
};

type WorkflowLightState = 'green' | 'progress' | 'red' | 'off';
type WorkflowStage = 'gpt' | 'agy' | 'claude';

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

function getWorkflowLight(workflow: WorkflowPayload | null, stage: WorkflowStage): WorkflowLightState {
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
  const job = workflow?.jobs?.find((item) => item.workflow_stage?.toLowerCase() === stage);
  if (typeof job?.progress === 'number' && Number.isFinite(job.progress)) {
    return Math.max(0, Math.min(100, Math.round(job.progress)));
  }
  const status = job?.status?.toLowerCase();
  if (status === 'succeeded' || status === 'completed' || status === 'success') return 100;
  if (status === 'running') return 50;
  return 0;
}

export default function Home() {
  const [copied, setCopied] = useState(false);
  const [errorCopied, setErrorCopied] = useState(false);
  const [dispatchMode, setDispatchMode] = useState<'test' | 'live'>('test');
  const [dispatchFlow, setDispatchFlow] = useState<'single' | 'loop'>('loop');
  const [taskText, setTaskText] = useState('');
  const [dispatchState, setDispatchState] = useState<DispatchState>('idle');
  const [dispatchJob, setDispatchJob] = useState('job-tg01-ready');
  const [dispatchCode, setDispatchCode] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [workflowState, setWorkflowState] = useState<WorkflowPayload | null>(null);
  const [dispatchProgress, setDispatchProgress] = useState<DispatchPhase[]>([]);
  const [dispatchSummary, setDispatchSummary] = useState('');
  const [bridgeHealth, setBridgeHealth] = useState<BridgeHealthState>('checking');
  const pollingToken = useRef(0);

  const bridgeLabel = bridgeHealth === 'connected'
    ? 'API linked'
    : bridgeHealth === 'checking'
      ? '檢查中'
      : bridgeHealth === 'offline'
        ? '不可達'
        : '待連線';

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
    } catch {
      setBridgeHealth('offline');
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
      .catch(() => {
        if (active) setBridgeHealth('offline');
      });
    return () => {
      active = false;
    };
  }, []);

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const copyWorkflowError = async () => {
    const query = workflowId ? `/workflow ${workflowId}` : '/workflow <flow_id>';
    const errorText = `E500 workflow error\n${dispatchSummary}\n查詢命令：${query}`;
    try {
      await navigator.clipboard.writeText(errorText);
      setErrorCopied(true);
      window.setTimeout(() => setErrorCopied(false), 1800);
    } catch {
      setErrorCopied(false);
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
      } catch {
        if (pollingToken.current !== token) return;
        setDispatchState('failed');
        setDispatchProgress(['queued', 'failed']);
        setDispatchSummary('無法讀取 job 結果，請稍後使用 /result 查詢。');
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
        const detail = error instanceof Error ? error.message : '未知錯誤';
        const failureMessage = `無法讀取 workflow 結果：${detail}。請使用 /workflow ${flowId} 查詢。`;
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
        return;
      }
    }

    if (pollingToken.current === token) {
      setDispatchState('failed');
      setDispatchProgress(['queued', 'failed']);
      const failureMessage = `等待 workflow 結果逾時，請使用 /workflow ${flowId} 查詢。`;
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
    const token = pollingToken.current + 1;
    pollingToken.current = token;
    setWorkflowId('');
    setWorkflowState(null);
    setErrorCopied(false);
    setDispatchCode('');
    setDispatchProgress([]);
    setDispatchSummary('');

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
          body: JSON.stringify({ task: taskText, mode: 'write', provider: 'codex' }),
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
      } catch {
        setDispatchState('blocked');
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

  return (
    <main className="site-shell">
      <div className="noise" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="E500 Control Plane 首頁">
          <span className="brand-mark"><span /></span>
          <span>E500 <em>/</em> CONTROL PLANE</span>
        </a>
        <nav className="nav-links" aria-label="主要導覽">
          <a href="#tg-command">TG 01</a>
          <a href="#architecture">架構</a>
          <a href="#lifecycle">生命週期</a>
          <a href="#commands">指令</a>
          <a href="#safety">安全閘</a>
        </nav>
        <a className="topbar-link" href="https://github.com/b827262-cell/Telegram-ai-code" target="_blank" rel="noreferrer">
          GitHub <span>↗</span>
        </a>
      </header>

      <section className="hero section-wrap" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="status-dot" /> TG-CODEX-CONTROL-001 <span className="eyebrow-rule" /> PHASE 01</div>
          <h1>Telegram 管理任務，<br /><span>Codex 專注交付。</span></h1>
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
            <div className="task-field"><span>/{dispatchFlow === 'loop' ? 'gpt' : 'run'}</span><textarea id="tg-task" value={taskText} onChange={(event) => { setTaskText(event.target.value); setDispatchState('idle'); setWorkflowId(''); setWorkflowState(null); setErrorCopied(false); setDispatchCode(''); }} rows={4} aria-describedby="tg-task-help" /></div>
            <p className="console-help" id="tg-task-help">{dispatchFlow === 'loop' ? <>依序排程 <strong>Codex → AGY → Claude</strong>，完成後上傳 redacted GitHub Markdown 報告。</> : <>會送往預設 provider <strong>codex</strong>，並保留 workspace-write / no-push 邊界。</>}</p>
            <div className="console-controls">
              <div className="flow-switch mode-switch" aria-label="工作流程">
                <button className={dispatchFlow === 'single' ? 'selected' : ''} onClick={() => setDispatchFlow('single')} type="button">單一 /run</button>
                <button className={dispatchFlow === 'loop' ? 'selected live' : ''} onClick={() => setDispatchFlow('loop')} type="button">GPT LOOP /gpt</button>
              </div>
              <div className="mode-switch" aria-label="派送模式">
                <button className={dispatchMode === 'test' ? 'selected' : ''} onClick={() => setDispatchMode('test')} type="button">測試佇列</button>
                <button className={dispatchMode === 'live' ? 'selected live' : ''} onClick={() => setDispatchMode('live')} type="button">實際派送</button>
              </div>
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
          </div>}
        </div>
      </section>

      <section className="architecture section-wrap" id="architecture">
        <div className="section-heading">
          <div><p className="section-kicker">01 / SYSTEM MAP</p><h2>一條清楚的主線，<br />把複雜度留在幕後。</h2></div>
          <p>第一階段只做一件事：讓 Telegram → job → Codex → result → Telegram 穩定閉環。其他模型先保留在下一個階段。</p>
        </div>
        <div className="pipeline" role="img" aria-label="Telegram 到 Codex 再回到 Telegram 的任務流程">
          <div className="pipeline-node telegram"><span className="node-index">01</span><span className="node-icon">TG</span><strong>Telegram</strong><small>你的入口</small></div><Arrow />
          <div className="pipeline-node controller"><span className="node-index">02</span><span className="node-icon">◈</span><strong>Controller</strong><small>權限 · queue · job_id</small></div><Arrow />
          <div className="pipeline-node codex"><span className="node-index">03</span><span className="node-icon">CX</span><strong>Codex</strong><small>repo · code · tests</small></div><Arrow />
          <div className="pipeline-node result"><span className="node-index">04</span><span className="node-icon">↺</span><strong>Result</strong><small>summary · diff · status</small></div>
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
              <div className="card-foot"><code>job.{item.key}</code><span>↗</span></div>
            </article>
          ))}
        </div>
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
