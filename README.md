# E500 Control Plane

E500 Control Plane 是部署在 ChatGPT Sites 的控制平面網站原始碼，以及 E500 本機開發與同步工作流的 GitHub 備份／協作 repository。

正式網站：`https://e500-control-plane.b827262.chatgpt.site/`

GitHub：`https://github.com/b827262-cell/e500-control-plane`

## Repository 定位

這個 repository 以 ChatGPT Sites 的 canonical source 為基礎，供以下用途：

- E500 本機開發與測試
- GitHub 版本備份與程式碼審查
- Codex / Claude 多模型協作
- ChatGPT Sites source repository 雙向同步
- Sites Version 建立與人工部署 Gate

首次 GitHub 匯入基準為 ChatGPT Sites commit：

```text
3b1b18821f2b5fcede6008a40d17c22ff19f9357
```

此 SHA 是匯入時經驗證的 Production V18 source baseline。

## 技術棧

- Next.js 16.2.6
- React 19.2.6
- Vinext 1.0.0-beta.3
- Vite 8.0.13
- TypeScript 5.9.3
- Tailwind CSS 4.2.1
- Cloudflare Workers / Wrangler
- OpenAI Sites Vite plugin

Node.js 需求：`>=22.13.0`

## 主要內容

網站包含 E500 控制平面的視覺化與操作入口，例如：

- SYSTEM MAP
- TG 01 / Telegram command surface
- JOB LIFECYCLE
- GIT SAFETY GATE
- WEBSITE STUDIO
- workflow / job execution log views

主要頁面程式碼位於 `app/`，靜態資源位於 `public/`。

## 本機建置

```bash
npm ci
npm run dev
```

常用驗證：

```bash
npm run build
npm run lint
```

若要模擬正式發布前檢查，先確認：

```bash
git status --short
git diff --check
npm run build
npm run lint
```

本機開發完成後，應先執行測試／build，再進行 Claude review；不要直接由未審查的 working tree 發布到 Sites。

## Git remotes

GitHub 工作副本建議使用兩個主要 remote：

```text
origin  → https://github.com/b827262-cell/e500-control-plane.git
sites   → ChatGPT Sites source repository
```

`origin` 用於 GitHub 備份、協作與 PR；`sites` 用於 ChatGPT Sites source 同步。

請勿把 Sites 短效 credential 寫入 remote URL、`.git/config`、shell history、README 或 report。

## E500 ↔ ChatGPT Sites 同步流程

本 repository 內附：

```text
skills/e500-chatgpt-sites-sync/SKILL.md
```

Skill 定義四個固定操作：

- `SITES STATUS`：只查 local / Git / Sites production 狀態
- `SITES SYNC DOWN`：Sites → E500，驗證 Production SHA 後安全 fast-forward
- `SITES SYNC UP`：E500 → Sites，build/test/review/commit/push/save version，但不自動 deploy
- `SITES DEPLOY`：只有在明確人工授權後才執行正式部署

同步原則：`local edit ≠ git push ≠ Sites Version ≠ production deploy`。

推薦發布流程：

```text
E500 local edit
→ build / lint / tests
→ Claude review
→ Git commit
→ GitHub backup / review as needed
→ Sites short-lived credential
→ push to Sites source
→ verify remote SHA
→ save Sites Version
→ HUMAN DEPLOY GATE
→ deploy
→ production verification
```

## 安全規則

- 不自動 force-push
- 不用 `git reset --hard` 覆蓋未保存工作
- production 與 local diverged 時停止並人工處理
- dirty worktree 不進行自動 sync-down
- credential 只使用短效、單次、不落盤的方式
- push、Sites Version、deploy 視為三個獨立授權階段
- deploy 後必須驗證正式網站與預期 SHA / Version

## E500 本機目錄

正式 Sites checkout：`web/e500-control-plane/`

GitHub 工作副本：`web/e500-control-plane-github/`

同一 E500 project 中另外還有：

```text
web/app/   → 獨立 Command Console，不是本 repo 的 canonical homepage source
web/main/  → rendered-site mirror/reference，不是 canonical source
```

不要用這兩個目錄覆蓋 `e500-control-plane`。

## 開發協作建議

工程修改建議採：

```text
Codex implementation
→ automated verification
→ Claude read-only review
→ bounded repair if needed
→ final review
→ Git / Sites gates
```

任何宣稱 `PASS`、`SYNCED` 或 `DEPLOYED` 的狀態都應附實際 command、SHA、測試或 production verification 證據。

## 狀態

GitHub repository 是 E500 Control Plane 的獨立版本控制與協作鏡像；ChatGPT Sites 仍保有自己的 source repository 與 production version/deploy 狀態。
