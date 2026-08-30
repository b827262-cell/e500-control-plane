---
name: chatgpt-sites-local-development
description: Start a website as a ChatGPT Sites draft, export its exact saved source tree to a local development checkout, promote the local checkout to the canonical source, synchronize local changes through GitHub, save new ChatGPT Sites versions from exact full-tree deltas, and explicitly deploy verified versions to chatgpt.site.
metadata:
  short-description: ChatGPT Site first → local canonical → sync back to Sites
---

# ChatGPT Sites → Local Development → Sites Publish

## Purpose

Use this skill when a website is first designed in ChatGPT Sites, then downloaded to a local machine for ongoing development, and later synchronized back to the same ChatGPT Site.

This is a **Site-first, then Local-first** workflow.

```text
ChatGPT Sites initial draft
→ save exact Sites source version
→ export exact source tree to local
→ establish Git/GitHub baseline
→ local becomes canonical source
→ local preview and edits
→ sync to GitHub
→ full-tree Sites delta
→ save new Sites version
→ review
→ explicit deploy
→ production verification
```

The governing invariant is:

```text
INITIAL SITE DESIGN ≠ LOCAL CANONICAL SOURCE ≠ GITHUB SYNC ≠ SITES SAVE ≠ PRODUCTION DEPLOY
```
## Required project parameters

Every managed site must have a small local state/config record containing at least:

```text
SITE_NAME
SITE_PROJECT_ID
SITE_URL
LOCAL_ROOT
GITHUB_REPO
DEV_PORT
CANONICAL_MODE=local
SITES_BASE_VERSION
SITES_BASE_SOURCE_SHA
SITES_BASE_TREE_SHA
GITHUB_BASELINE_SHA
```

Do not store Sites credentials, cookies, auth headers, API keys, or browser tokens in this file.

Recommended local state filename:

```text
.site-local-state.json
```

The state file records verified identifiers and SHAs only. Treat it as operational metadata, not as an authentication store.

## Stable operator intents

Interpret these phrases as stable commands:

- `SITE DRAFT` — create or refine the initial website in ChatGPT Sites only.
- `SITE DOWNLOAD` — export the latest saved Sites source tree to a new local checkout.
- `SITE LOCAL INIT` — initialize local Git/GitHub and promote local source to canonical mode.
- `SITE STATUS` — inspect local, GitHub, saved-version, and production state without mutation.
- `SITE SYNC` — publish verified local changes to GitHub and regenerate a full-tree Sites handoff.
- `SITE SAVE` — apply the verified handoff to the current Sites saved base and save one new Sites version; do not deploy.
- `SITE DEPLOY` — deploy one exact previously reviewed Sites version after explicit authorization.
## Phase 1 — Design the initial Site in ChatGPT

Use ChatGPT Sites for rapid visual/product iteration until the first usable draft is ready.

Before downloading it to local development, create/save an explicit Sites version and record:

```text
INITIAL_SITES_VERSION
INITIAL_SITES_SOURCE_SHA
INITIAL_SITES_TREE_SHA
```

Do not scrape the public `*.chatgpt.site` HTML as the local source. The public site is a deployed artifact and may lag behind the latest saved source.

The authoritative bootstrap source is the **exact saved Sites source tree**.

If latest saved and production differ, prefer latest saved for bootstrap only when the user explicitly selects that saved draft as the development baseline.

## Phase 2 — Download exact Site source to local

Create a new local project directory from the exact saved source tree.

Required checks:

```text
downloaded source SHA == selected Sites saved source SHA
local tree SHA == selected Sites saved tree SHA
worktree is complete
no credential material was exported
```

Preserve the original Sites lineage metadata separately from GitHub lineage. Never rewrite the Sites source history merely to make it look like a GitHub clone.

After exact verification, record the selected Sites version/SHA/tree as the first local Sites baseline.
## Phase 3 — Promote local source to canonical mode

Once the exact saved source has been downloaded and verified, the local checkout becomes the primary development source.

Initialize or attach Git/GitHub without changing the site content:

```text
local exact Sites tree
→ Git commit
→ GitHub repository
→ verify remote commit/tree
→ set GITHUB_BASELINE_SHA
→ set CANONICAL_MODE=local
```

From this point forward, ordinary website edits should happen locally first.

Direct edits made later inside ChatGPT Sites are treated as remote drift. If a saved Sites tree changes independently from the recorded base, `SITE SYNC` and `SITE SAVE` must stop until the difference is inspected and reconciled.

Never silently overwrite independent Sites edits with local content.

## Phase 4 — Local development loop

The normal daily loop is:

```text
edit local files
→ run tests/lint/typecheck/build when available
→ start local dev server
→ verify localhost UI/API behavior
→ press local Sync button or run SITE SYNC
```

The local preview is the place to validate appearance and behavior before publication.

A project may expose localhost and a private network/Tailscale address, but the synchronization helper itself should remain bound to loopback unless a task explicitly requires otherwise.
## Phase 5 — SITE SYNC: local → GitHub

`SITE SYNC` must first verify that the recorded GitHub baseline is still fresh.

Required behavior:

```text
baseline fresh + no local changes
→ NO_CHANGES / IN_SYNC

baseline fresh + valid local changes
→ test/build gate
→ explicit commit
→ push GitHub
→ verify remote SHA/tree
→ update GITHUB_BASELINE_SHA

baseline stale or remote moved unexpectedly
→ BLOCKED
```

Do not use `git add .`, force push, hard reset, or automatic destructive conflict resolution.

A local Sync button may call a loopback helper, but success must mean the verified GitHub remote matches the intended local commit/tree; button color alone is not evidence.

After every successful GitHub change, regenerate the Sites handoff from the current authoritative saved Sites tree.

## Critical rule — handoff scope is dynamic

Never maintain a permanent hard-coded list such as `7 paths`, `12 paths`, or any other assumed publication set.

For every Sites update compute:

```text
ACTUAL_CURRENT_SITES_SAVED_TREE
        ↓ full tree diff
CURRENT_VERIFIED_GITHUB_TARGET_TREE
        ↓
COMPLETE_CHANGED_PATH_SET
```

The changed-path manifest must be derived from the two actual trees at that moment.
## Phase 6 — Generate the Sites handoff

A handoff must identify the exact Sites base and the exact local/GitHub target.

Record at least:

```text
SITE_PROJECT_ID
EXPECTED_SITES_BASE_VERSION
EXPECTED_SITES_BASE_SOURCE_SHA
EXPECTED_SITES_BASE_TREE_SHA
GITHUB_REFERENCE_SHA
GITHUB_TARGET_TREE_SHA
COMPLETE_CHANGED_PATH_SET
```

For every changed path, record whether it is added, modified, or deleted, plus its target content hash.

The handoff is valid only when applying the complete path set to the exact Sites base reconstructs the GitHub target tree exactly.

Required proof:

```text
APPLIED_TREE_SHA == GITHUB_TARGET_TREE_SHA
```
If any source-tree difference exists outside the manifest, the handoff is incomplete and must be rejected.

Do not use the GitHub commit SHA as the Sites parent. GitHub is the target reference; Sites keeps its own saved-version lineage.

Recommended generated files:

```text
reports/SITES-HANDOFF-LATEST.md
reports/SITES-DELTA-LATEST.json
reports/SITES-DELTA-LATEST.patch
```

## Phase 7 — SITE SAVE: create one new Sites version

Before saving, query the current latest saved Sites version again.

Require exact base freshness:

```text
current latest saved version == EXPECTED_SITES_BASE_VERSION
current latest saved source SHA == EXPECTED_SITES_BASE_SOURCE_SHA
current latest saved tree SHA == EXPECTED_SITES_BASE_TREE_SHA
```

If any value moved, stop and regenerate the handoff from the new base.

Apply the complete dynamic delta, run the applicable tests/build checks, verify the reconstructed full tree, then save exactly one new Sites version.
After save, record and verify:

```text
NEW_SITES_VERSION
NEW_SITES_SOURCE_SHA
NEW_SITES_TREE_SHA
NEW_SITES_PARENT_SHA
```

Require:

```text
NEW_SITES_TREE_SHA == GITHUB_TARGET_TREE_SHA
```

Stop after save unless the user explicitly requested deployment of that exact saved version.

## Phase 8 — Independent review gate

Before production deploy, an independent reviewer should verify actual evidence, not only the implementation agent's summary.

Review at least:

```text
saved version identity
saved source SHA
saved parent/lineage
saved tree == intended GitHub target tree
build/test evidence
production is still on the previous version
```

Valid outcomes:

```text
READY_FOR_EXACT_DEPLOY
BLOCKED
```

A reviewer must not mutate the saved version while reviewing it.
## Phase 9 — SITE DEPLOY: exact saved version only

Deployment changes the public `chatgpt.site` website and requires explicit authorization for the intended saved version.

Immediately before deploy, re-query official Sites state and require the reviewed saved version/source/tree to remain unchanged.

Deploy that exact version only.

After deployment verify the real production URL:

```text
HTTP success
expected new UI markers present
known old markers removed when intended
critical API/health routes behave as expected
production version == intended saved version
```

Do not treat a successful save as a successful deploy.

## Optional browser userscript workflow

A project may use a Tampermonkey-compatible userscript on `chatgpt.com/sites` to provide a button such as `<SITE_NAME> 更新`.

The userscript should only:

```text
read the current validated local Sites prompt
find the real ChatGPT Sites composer
fill the composer
show a review-required status
```

It must not automatically submit the prompt, save a Sites version, or deploy production.
For iframe-heavy Sites pages, prevent duplicate injection with both metadata and runtime protection:

```javascript
// @noframes
if (window.top !== window.self) return;
```

Prefer the current visible Sites composer, for example a visible ProseMirror/contenteditable editor, over hidden mirror textareas.

If the composer cannot be identified unambiguously, fail closed and do not fill anything.

## SITE STATUS report

A status check should report:

```text
SITE_NAME
SITE_PROJECT_ID
LOCAL_ROOT
LOCAL_HEAD
LOCAL_TREE
GITHUB_HEAD
GITHUB_TREE
LOCAL_GITHUB_IN_SYNC: YES | NO
LATEST_SAVED_VERSION
LATEST_SAVED_SOURCE_SHA
LATEST_SAVED_TREE_SHA
PRODUCTION_VERSION
PRODUCTION_SOURCE_SHA
PRODUCTION_TREE_SHA
LOCAL_MATCHES_LATEST_SAVED: YES | NO
LOCAL_MATCHES_PRODUCTION: YES | NO
RESULT
```

Status is read-only.
## Drift handling

After `CANONICAL_MODE=local`, any independent change to the Sites saved tree is remote drift.

Decision table:

| State | Action |
| --- | --- |
| Sites saved tree equals recorded base | Continue normal local-first workflow. |
| Sites saved tree moved and local has no new work | Inspect and optionally sync the new Sites source down before continuing. |
| Sites saved tree moved and local also changed | BLOCKED; compare both trees and reconcile deliberately. |
| Production moved but latest saved did not | Re-query deployment history before any new deploy. |
| GitHub moved independently | BLOCKED until GitHub baseline is reconciled. |

Never solve drift with force push, hard reset, silent overwrite, or an assumed path list.

## Rollback

Rollback must select a known prior Sites saved version and requires explicit authorization.

Record:

```text
CURRENT_PRODUCTION_VERSION
ROLLBACK_TARGET_VERSION
ROLLBACK_TARGET_SOURCE_SHA
ROLLBACK_TARGET_TREE_SHA
```

Deploy the exact prior version using the official Sites deployment mechanism, then verify the public site again.

Do not rewrite Git history as a substitute for a Sites production rollback.
## New-site bootstrap checklist

For every new website, execute this checklist once:

```text
1. Design initial draft in ChatGPT Sites.
2. Save one explicit Sites version.
3. Record project ID, site URL, version, source SHA, and tree SHA.
4. Export that exact saved source tree to LOCAL_ROOT.
5. Verify exact local tree equality.
6. Run the project locally and verify the first localhost preview.
7. Initialize Git and create/connect the GitHub repository.
8. Push the exact initial tree and verify GitHub tree equality.
9. Create .site-local-state.json and set CANONICAL_MODE=local.
10. Install/configure the local Sync button/helper when desired.
11. Configure optional ChatGPT Sites userscript when desired.
12. Run SITE STATUS and require all baseline checks to pass.
```

After step 12, the one-time bootstrap is complete. All future development follows the local-first loop.

## Normal update checklist

```text
1. Edit locally.
2. Test on localhost.
3. SITE SYNC → GitHub.
4. Query current latest saved Sites tree.
5. Compute full dynamic tree delta.
6. Prove applied tree == GitHub target tree.
7. SITE SAVE → exactly one new Sites version.
8. Independent review.
9. SITE DEPLOY exact reviewed version.
10. Verify public chatgpt.site.
```
## Completion definitions

`SITE DOWNLOAD` is complete only when the local tree is proven identical to the selected saved Sites tree.

`SITE LOCAL INIT` is complete only when GitHub contains the same initial tree and local canonical mode is recorded.

`SITE SYNC` is complete only when the intended local commit/tree matches GitHub and a fresh full-tree handoff can be generated.

`SITE SAVE` is complete only when the new saved Sites tree matches the intended GitHub target tree exactly.

`SITE DEPLOY` is complete only when the exact reviewed version is deployed and the public site is independently verified.

## Core safety invariants

```text
public HTML is not authoritative source
latest saved Sites source may differ from production
changed-path scope must be computed dynamically
GitHub SHA is not a Sites parent SHA
save is not deploy
button success is not proof without SHA/tree verification
local becomes canonical only after exact bootstrap verification
```

When any required identity, SHA, tree, or baseline cannot be verified, stop with `BLOCKED` rather than guessing.

## Recommended terminal result shape

```text
RESULT: PASS | BLOCKED
SITE_PROJECT_ID:
LOCAL_HEAD:
GITHUB_HEAD:
LATEST_SAVED_VERSION:
LATEST_SAVED_SOURCE_SHA:
LATEST_SAVED_TREE_SHA:
PRODUCTION_VERSION:
PRODUCTION_SOURCE_SHA:
PRODUCTION_TREE_SHA:
NEXT: COMPLETE | SITE_SAVE | REVIEW | SITE_DEPLOY | RECONCILE
```
