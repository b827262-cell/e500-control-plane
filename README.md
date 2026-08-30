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

## ChatGPT Sites → 本機開發 → Site 更新

本 repository 也包含一個可重複用於「新網站」的通用 Skill：

```text
skills/chatgpt-sites-local-development/SKILL.md
skills/chatgpt-sites-local-development/site-local-state.example.json
```

這個流程採 **Site-first，之後 Local-first**：第一次先在 ChatGPT Sites 快速完成網站初稿；Save 一個可識別的 Sites Version 後，把該版本的完整 source tree 下載到本機。完成本機 build / preview 驗證與 GitHub 初始化後，從此由本機 checkout 成為日後主要開發來源。

第一次建立網站：

```text
ChatGPT 設計 Site 初稿
→ Save Sites Version
→ 下載該 saved version 的完整 source tree
→ 建立本機開發 checkout
→ npm install / build / local preview
→ 初始化 Git / GitHub
→ 記錄 Sites project / saved version / source SHA / local root / GitHub repo
→ 本機正式成為 canonical development source
```

之後日常更新：

```text
本機修改
→ localhost 預覽與測試
→ 同步鍵
→ GitHub
→ 讀取目前 Sites latest saved tree
→ 與最新 GitHub target tree 做完整 full-tree diff
→ 產生動態 handoff
→ Save 新 Sites Version
→ 獨立審查
→ Deploy exact saved version
→ 驗證 chatgpt.site 正式內容
```

### 為什麼 handoff 必須動態計算

不要把 Sites 更新固定成「永遠只同步某幾個檔案」。每次都必須比較 **目前 Sites saved tree** 與 **最新 GitHub target tree**，由實際差異決定這次需要 3、7、15 或更多 paths。只有在套用後的完整 tree 與 target tree 完全一致時，才允許 Save 新 Sites Version。

核心 gate：

```text
APPLIED_SITES_TREE == GITHUB_TARGET_TREE
```

如果不相等，必須 fail closed，不得 Save 半成品。

### 新網站需要的參數

每個新網站只需建立自己的 state/config，至少記錄：

```text
SITE_NAME
SITE_PROJECT_ID
SITE_URL
LOCAL_ROOT
GITHUB_REPO
DEV_PORT
LATEST_SAVED_VERSION
LATEST_SAVED_SOURCE_SHA
LATEST_DEPLOYED_VERSION
```

可從 `site-local-state.example.json` 複製成專案自己的設定檔，再填入實際值。不要把 token、cookie、Sites credential 或任何密鑰寫入 state、Git 或 README。

### 建議固定操作語意

- `SITE BOOTSTRAP`：從 ChatGPT Sites 已保存初稿建立本機開發環境與 GitHub。
- `SITE STATUS`：只讀檢查 local / GitHub / Sites saved / deployed 狀態。
- `SITE SYNC`：本機驗證後同步到 GitHub；沒有變更時必須安全 no-op。
- `SITE SAVE`：用 latest saved Sites tree 與 GitHub target tree 算完整差異，驗證 exact tree 後 Save 新 Sites Version。
- `SITE DEPLOY`：只部署明確指定、已驗證的 saved version。

整個模型可簡化為：

```text
第一次：ChatGPT Site 初稿 → 下載本機 → 建 GitHub
之後：本機修改 → 同步 → Save → 審查 → Deploy
```

但仍需保持這個安全不變式：

```text
LOCAL EDIT ≠ GITHUB SYNC ≠ SITES SAVE ≠ PRODUCTION DEPLOY
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
