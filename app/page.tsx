'use client';

import { useState, type FormEvent } from 'react';

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
  ['/status', '查看 queue 與 running jobs'],
  ['/result <job_id>', '查詢任務結果'],
  ['/cancel <job_id>', '取消未完成任務'],
];

function Arrow() {
  return <span className="pipeline-arrow" aria-hidden="true">→</span>;
}

type DispatchState = 'idle' | 'queued' | 'blocked' | 'checking' | 'verified';

export default function Home() {
  const [copied, setCopied] = useState(false);
  const [dispatchMode, setDispatchMode] = useState<'test' | 'live'>('test');
  const [taskText, setTaskText] = useState('修正 Telegram worker 在 job timeout 後沒有清除 lock 的問題。完成後執行 pytest，不要 push。');
  const [dispatchState, setDispatchState] = useState<DispatchState>('idle');
  const [dispatchJob, setDispatchJob] = useState('job-tg01-ready');

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const submitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!taskText.trim()) return;

    if (dispatchMode === 'live') {
      setDispatchState('checking');
      try {
        const response = await fetch('/api/tg/health', { cache: 'no-store' });
        const payload = await response.json() as { ok?: boolean; bridgeConfigured?: boolean };
        setDispatchState(payload.ok ? 'verified' : 'blocked');
      } catch {
        setDispatchState('blocked');
      }
      return;
    }

    setDispatchJob('job-demo-tg01');
    setDispatchState('queued');
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
            <div className="credential-chip"><i className="chip-pending" /><span>CODEX BRIDGE</span><strong>待連線</strong></div>
          </div>
          <p className="tg-safety-note"><span>⌁</span> Token 不放進前端，也不用貼在聊天裡；正式連線時只會讀取 Sites 的私密設定。</p>
        </div>

        <div className="tg-console">
          <div className="console-top"><span className="console-label"><b /> TG 01 / COMMAND CONSOLE</span><span className={`console-mode ${dispatchMode}`}>{dispatchMode === 'test' ? 'TEST MODE' : 'LIVE MODE'}</span></div>
          <form onSubmit={submitTask}>
            <label className="console-label-text" htmlFor="tg-task">COMMAND PAYLOAD <span>/run</span></label>
            <div className="task-field"><span>/run</span><textarea id="tg-task" value={taskText} onChange={(event) => { setTaskText(event.target.value); setDispatchState('idle'); }} rows={4} aria-describedby="tg-task-help" /></div>
            <p className="console-help" id="tg-task-help">會送往預設 provider <strong>codex</strong>，並保留 workspace-write / no-push 邊界。</p>
            <div className="console-controls">
              <div className="mode-switch" aria-label="派送模式">
                <button className={dispatchMode === 'test' ? 'selected' : ''} onClick={() => setDispatchMode('test')} type="button">測試佇列</button>
                <button className={dispatchMode === 'live' ? 'selected live' : ''} onClick={() => setDispatchMode('live')} type="button">實際派送</button>
              </div>
              <button className="send-button" disabled={dispatchState === 'checking'} type="submit">{dispatchMode === 'test' ? '送出測試命令' : '檢查實際連線'} <span>↗</span></button>
            </div>
          </form>
          <div className={`dispatch-result ${dispatchState}`} role="status" aria-live="polite">
            {dispatchState === 'idle' && <><span className="result-icon">○</span><span>Ready / 等待命令</span><code>POST /tg/run</code></>}
            {dispatchState === 'queued' && <><span className="result-icon result-ok">✓</span><span><strong>Codex job queued</strong> / 測試回應</span><code>{dispatchJob}</code></>}
            {dispatchState === 'checking' && <><span className="result-icon result-checking">◌</span><span><strong>Checking Telegram Bot</strong> / 正在驗證連線</span><code>GET /api/tg/health</code></>}
            {dispatchState === 'verified' && <><span className="result-icon result-ok">✓</span><span><strong>Telegram Bot verified</strong> / Codex bridge 尚未設定</span><code>BRIDGE_REQUIRED</code></>}
            {dispatchState === 'blocked' && <><span className="result-icon result-warn">!</span><span><strong>Live dispatch blocked</strong> / 請檢查 Bot 設定</span><code>CONFIG_REQUIRED</code></>}
          </div>
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
