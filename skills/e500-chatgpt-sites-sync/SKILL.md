---
name: e500-chatgpt-sites-sync
description: Safely synchronize the E500 canonical ChatGPT Sites checkout with the live ChatGPT Sites source repository in both directions, with build/test/review gates, ephemeral credentials, exact SHA verification, Sites version creation, and an explicit human deploy gate.
metadata:
  short-description: E500 ↔ ChatGPT Sites safe sync workflow
---

# E500 ↔ ChatGPT Sites Sync

## Purpose

Use this skill when working on the E500 ChatGPT Sites project and the task is to inspect, synchronize, modify, publish a source version, or deploy the site.

This skill separates local development, Git synchronization, Sites version creation, and production deployment into distinct gates. Never treat `git push`, `save version`, and `deploy` as the same action.

```text
E500 local source
→ build/test/review
→ Git commit
→ authenticated push
→ verify remote SHA
→ save Sites version
→ HUMAN DEPLOY GATE
→ deploy
→ production verification
```

## Canonical targets
The canonical development checkout is:

```text
/home/b827262/project/e500-codex-smoke/web/e500-control-plane/
```

The production site is:

```text
https://e500-control-plane.b827262.chatgpt.site/
```

The following paths are separate products/reference trees and must not be overwritten by this skill unless the task explicitly says so:

```text
web/app/   # separate Command Console
web/main/  # mirror/reference only
```

The canonical checkout must preserve its Sites Git remote. Do not replace the remote with GitHub or a mirror repository.

Do not hardcode a production SHA as permanent truth. A previously verified SHA is only historical evidence; always query the current Sites production version/SHA before a synchronization that depends on freshness.

## Command intents

Treat these phrases as stable operator intents:

- `SITES STATUS` — inspect local/remote/version state only.
- `SITES SYNC DOWN` — safely synchronize the current Sites source toward E500.
- `SITES SYNC UP` — validate local changes, push source, verify SHA, and save a Sites version; stop before deploy.
- `SITES DEPLOY` — deploy only after explicit user authorization for a specific saved version/SHA.
## Global safety rules

- Never force-push, rewrite history, or silently reset local work to production.
- Never overwrite a dirty working tree to make synchronization easier.
- Never use `git add .`; stage explicit intended paths only.
- Never print, log, persist, commit, or place a Sites credential/token in a remote URL, `.git/config`, shell history, task report, prompt, or environment dump.
- Use only an official short-lived Sites source-repository credential for authenticated Sites Git operations.
- Prefer per-command/in-memory authentication such as an HTTP authorization header; credential persistence is forbidden.
- A successful push does not authorize saving a Sites version unless the task allows it.
- A successful push or saved version does not authorize deployment.
- Deployment requires an explicit user instruction for the intended version/SHA.
- If local and production history diverge, stop and require a human merge/reconciliation decision; do not resolve by force.
- Preserve unrelated dirty/untracked files and report them separately from task-scoped changes.

## Evidence hierarchy

When evidence disagrees, trust observed state in this order:

```text
current Sites production version/SHA
> live remote Git SHA
> local Git object/SHA
> build/test/runtime evidence
> agent narrative
```

Never claim a sync, save, or deploy completed solely because an agent said it completed. Verify the resulting SHA/version/state.

## SITES STATUS

Run this as a read-only operation. At minimum inspect:

```bash
cd /home/b827262/project/e500-codex-smoke/web/e500-control-plane
git status --short
git rev-parse HEAD
git branch --show-current
git remote -v
```
Also query the official Sites control plane for the current production version and production commit SHA when that information is available to the calling environment.

Report at least:

```text
LOCAL_HEAD:
LOCAL_BRANCH:
WORKTREE: CLEAN | DIRTY
ORIGIN:
PRODUCTION_VERSION:
PRODUCTION_SHA:
HEAD_MATCHES_PRODUCTION: YES | NO | UNKNOWN
RESULT: PASS | BLOCKED
```

`SITES STATUS` must not fetch with a credential, modify files, commit, push, save a version, or deploy unless the operator separately requests that action.

## SITES SYNC DOWN

Goal: bring the current authoritative Sites source toward E500 without destroying local work.

Required sequence:

```text
local preflight
→ query production version/SHA
→ obtain short-lived Sites credential when fetch requires it
→ fetch exact production commit/ref
→ compare histories
→ apply only a safe update
→ verify local HEAD/worktree
```
Decision table after fetch:

| State | Action |
| --- | --- |
| `LOCAL_HEAD == PRODUCTION_SHA` | No-op; report already synchronized. |
| Local is an ancestor of production and worktree is clean | Fast-forward only to production. |
| Local is ahead of production | Do not reset; report local-ahead state and stop. |
| Local and production diverged | BLOCKED; require human reconciliation. |
| Update is needed but worktree is dirty | BLOCKED; preserve local changes. |
| Production SHA cannot be verified | BLOCKED; do not guess. |

Never use `git reset --hard`, force checkout, rebase, or force-push as an automatic sync-down strategy.

After a successful sync-down, verify:

```bash
git rev-parse HEAD
git status --short
git log -1 --oneline
```

If the requested goal is exact production parity, require:

```text
LOCAL_HEAD == PRODUCTION_SHA
```

Report the credential only as `EPHEMERAL_AUTH: USED | NOT_NEEDED`; never include its value.

## Local development gate
Before editing, record the exact baseline:

```bash
cd /home/b827262/project/e500-codex-smoke/web/e500-control-plane
git status --short
git rev-parse HEAD
git remote -v
node --version
npm --version
```

Modify only the canonical checkout unless scope explicitly says otherwise. After edits, inspect task-scoped changes with `git diff -- <paths>` and preserve unrelated changes.

Run the repository's real scripts from `package.json`. At minimum, when present and applicable:

```bash
npm ci
npm run build
npm test
npm run lint
npm run typecheck
```

Do not invent missing scripts. Record absent scripts as `NA`.

For UI/site changes, start a bounded local preview/dev server, verify HTTP 200, inspect the affected route/anchor, and stop the server cleanly after validation.

When the page is expected to retain known control-plane sections, verify relevant markers such as `SYSTEM MAP`, `TG 01`, `JOB LIFECYCLE`, `GIT SAFETY GATE`, and `WEBSITE STUDIO` when they remain part of the current product.

## Review gate
For production-affecting source changes, require an independent read-only review before publication. The default E500 review pattern is Codex implementation followed by Claude review.

The reviewer must inspect actual source/diff and test evidence. A narrative summary alone is insufficient.

Valid review outcomes:

```text
PASS
PASS_WITH_FIXES
BLOCKED
```

`PASS_WITH_FIXES` returns the bounded findings to the implementation agent, then tests and review repeat. Do not advance to publication while required fixes remain.

## SITES SYNC UP

Goal: publish a verified local commit to the Sites source repository and create a Sites version, while stopping before production deployment unless deployment was separately authorized.

Required sequence:

```text
preflight and production SHA check
→ build/test/local preview
→ independent review
→ task-scoped diff and secret checks
→ explicit Git commit
→ obtain ephemeral Sites credential
→ authenticated push
→ fetch/verify live remote SHA
→ save Sites version
→ STOP at HUMAN DEPLOY GATE
```

Before publication, re-query current production version/SHA. If production changed since the task baseline, fetch and compare histories before pushing. Do not publish over unseen production changes.

A publishable tree must have an explicit commit SHA. Never publish an ambiguous dirty working tree.

Use explicit staging only:

```bash
git status --short
git diff --check
git add <explicit-task-files>
git diff --cached --check
git diff --cached -- <explicit-task-files>
git commit -m "<scoped message>"
git rev-parse HEAD
```

Before staging/commit, perform the repository's secret/credential checks. Never include `.env`, tokens, credentials, cookies, private keys, or generated credential files.

## Sites Git authentication

The Sites Git remote may require authentication not available to an ordinary shell. When authenticated fetch/push is required:

1. Obtain an official short-lived source repository credential from the Sites control plane.
2. Use it for the exact Git operation only.
3. Prefer an in-memory/per-command HTTP header mechanism.
4. Do not rewrite `origin` to contain the credential.
5. Do not configure a persistent credential helper for the Sites token.
6. Do not echo the credential or include it in a report.

After the operation, report only whether ephemeral authentication was used and whether the operation succeeded.

## Push verification

A successful Git command message is not enough. After push, fetch the live source state and require the intended remote commit to equal the local commit selected for publication.

Record:

```text
LOCAL_COMMIT_SHA:
REMOTE_COMMIT_SHA:
PUSH_SHA_MATCH: YES | NO
```

If the SHAs do not match, stop before saving a Sites version.

Never force-push. If the live remote moved between preflight and push, stop and reconcile safely.

## Save Sites version gate

Creating/saving a Sites version is a separate action from Git push. Only save the version corresponding to the verified remote commit.

Record:

```text
SITES_VERSION:
VERSION_SOURCE_SHA:
VERSION_SAVED: YES | NO
```

After saving, verify that the created version references the intended source state when the Sites tools expose that information.

Unless the user explicitly authorized deployment in the same request, stop here and report:

```text
READY_FOR_DEPLOY: YES
NEXT: HUMAN_DEPLOY_APPROVAL
```

## SITES DEPLOY

Deployment is production-changing and requires explicit user authorization. Do not infer deploy approval from requests such as `sync`, `push`, `publish source`, `save version`, `prepare release`, or `make ready`.

Before deploy, bind the authorization to a specific version and/or SHA:

```text
DEPLOY_VERSION:
DEPLOY_SOURCE_SHA:
USER_AUTHORIZED_DEPLOY: YES
```

If the intended version/SHA has changed since approval, stop and request new approval.

Deploy using the official Sites deployment mechanism only. Do not substitute a local HTTP upload, mirror synchronization, or force push.

## Production verification

After deploy, verify the actual production site rather than assuming deployment success.

At minimum verify:

- production URL responds successfully;
- expected changed content/behavior is present;
- critical retained content is still present when applicable;
- the reported production version/SHA matches the intended deployment when Sites exposes it;
- no obvious runtime/build error is visible.

For the E500 control plane, the production URL is:

```text
https://e500-control-plane.b827262.chatgpt.site/
```

A fragment such as `#tg-command` is a browser anchor within the same site, not a separate source repository.

## Conflict and blocker handling

Use a fail-closed result when a safe automatic transition is not possible.

Examples include:

- local/production Git divergence;
- dirty worktree when a sync-down update is required;
- missing or unverifiable production SHA;
- missing official Sites credential when authenticated Git access is required;
- push SHA mismatch;
- build/test/review failure;
- suspected credential in task changes;
- deployment requested without explicit version/SHA authorization.

Use this terminal shape:

```text
RESULT: BLOCKED
REASON: <specific blocker>
NEEDS_HUMAN_DECISION: YES
NEXT: HUMAN_DECISION
```

Do not bypass a blocker by force-pushing, hard-resetting, silently dropping local changes, or deploying a different version.

## Rollback

Rollback is also production-changing. It requires explicit authorization and a known prior Sites version/source SHA.

Before rollback record:

```text
CURRENT_PRODUCTION_VERSION:
CURRENT_PRODUCTION_SHA:
ROLLBACK_TARGET_VERSION:
ROLLBACK_TARGET_SHA:
USER_AUTHORIZED_ROLLBACK: YES
```

Use the official Sites version/deploy mechanism. Do not rewrite Git history as a substitute for a production rollback.

After rollback, perform the same production verification gate as a normal deploy.

## Standard report

For a synchronization or publication task, write observed evidence to `reports/<TASK-ID>.md` when the task requires a durable project report.

Recommended fields:

```text
TASK:
OPERATION: STATUS | SYNC_DOWN | SYNC_UP | DEPLOY | ROLLBACK
CANONICAL_PATH:
LOCAL_BRANCH:
LOCAL_HEAD_BEFORE:
LOCAL_HEAD_AFTER:
WORKTREE_BEFORE: CLEAN | DIRTY
WORKTREE_AFTER: CLEAN | DIRTY
PRODUCTION_VERSION_BEFORE:
PRODUCTION_SHA_BEFORE:
EPHEMERAL_AUTH: USED | NOT_NEEDED
BUILD: PASS | FAIL | NA
TEST: PASS | FAIL | NA
LINT: PASS | FAIL | NA
TYPECHECK: PASS | FAIL | NA
LOCAL_PREVIEW: PASS | FAIL | NA
REVIEW: PASS | PASS_WITH_FIXES | BLOCKED | NA
COMMIT_SHA:
PUSH: PASS | FAIL | NOT_DONE
REMOTE_SHA:
PUSH_SHA_MATCH: YES | NO | NA
SITES_VERSION:
VERSION_SAVED: YES | NO | NOT_DONE
DEPLOY: PASS | FAIL | NOT_DONE
PRODUCTION_VERSION_AFTER:
PRODUCTION_SHA_AFTER:
PRODUCTION_VERIFY: PASS | FAIL | NOT_DONE
RESULT: PASS | BLOCKED
NEXT: COMPLETE | HUMAN_DEPLOY_APPROVAL | HUMAN_DECISION
```

Never put credential values, cookies, private URLs containing authentication, or raw environment dumps in the report.

## Operator examples

### Status only

```text
SITES STATUS
```

Meaning: inspect local checkout, Git state, and current Sites production version/SHA; change nothing.

### Pull current production source toward E500

```text
SITES SYNC DOWN
```

Meaning: query production, fetch using ephemeral auth if needed, fast-forward only when safe, and verify exact SHA. Never overwrite local work.

### Publish local work but do not deploy

```text
SITES SYNC UP:
validate the canonical checkout, run build/tests and review, commit the approved task files, push with ephemeral Sites auth, verify remote SHA, save a Sites version, and stop before deploy.
```

Expected terminal state:

```text
READY_FOR_DEPLOY: YES
NEXT: HUMAN_DEPLOY_APPROVAL
```

### Deploy a prepared version

```text
SITES DEPLOY: deploy Sites Version <N> / SHA <sha>
```

This is valid only when the user explicitly authorizes that exact production change.

## Completion definition

`SYNC_DOWN` is complete only when the requested safe local synchronization state is verified.

`SYNC_UP` is complete only when build/test/review gates pass, the intended local commit matches the live Sites Git source after push, and the Sites version is saved. It must not imply production deployment.

`DEPLOY` is complete only when the explicitly authorized version is deployed and the production site is independently verified.

The governing invariant is:

```text
LOCAL EDIT ≠ GIT PUSH ≠ SITES VERSION ≠ PRODUCTION DEPLOY
```

Keep these states separate in commands, reports, approvals, and verification.
