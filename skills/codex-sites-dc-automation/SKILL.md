---
name: codex-sites-dc-automation
description: Automate safe ChatGPT Sites operations from Codex Desktop using Remote Desktop Commander, Codex mode, and @site. Detect the correct Codex Desktop window, place a reviewed Sites instruction into the composer, submit it, monitor the Sites execution, and enforce read-first inventory/diff/merge gates with zero destructive writes by default.
metadata:
  short-description: DC → Codex Desktop → @site → safe Sites execution
---

# Codex Desktop + DC → ChatGPT Sites Automation

## Purpose

Use this skill when the operator wants ChatGPT/Codex to control a ChatGPT Site through **Codex Desktop** rather than manually copying a long prompt into another ChatGPT Work conversation.

The intended path is:

```text
validated local/Sites task
→ Remote Desktop Commander (DC)
→ Codex Desktop
→ Codex mode
→ @site <site intent>
→ submit
→ monitor Sites execution
→ inventory / diff / gate
→ minimum required write
→ production verification
```

This skill is complementary to `chatgpt-sites-local-development` and other repository-specific Sites skills. It does not replace source/tree/SHA rules, deployment gates, or project-specific data validation.

## Core invariant

```text
DC UI AUTOMATION ≠ SITES AUTHORIZATION ≠ DATA WRITE ≠ SOURCE SAVE ≠ DEPLOY
```

A successful paste or submission only means the instruction reached Codex Desktop. It is not evidence that Sites read, wrote, saved, deployed, or verified anything.

## When to use

Use this skill for tasks such as:

- Send a reviewed `@site` instruction to Codex Desktop automatically.
- Avoid manually copying large Sites handoff prompts.
- Ask `@site` to inspect current production state.
- Run read-first `PRESERVE + DIFF + MERGE` workflows.
- Monitor a multi-step Sites execution from the desktop.
- Continue only after explicit freshness/version/API gates pass.
- Reconcile an existing Production database with a reviewed handoff package without destructive cleanup.

Do not use this skill to bypass authentication, extract session cookies, scrape credentials, or synthesize authorization the operator does not have.

## Required parameters

Every execution should know, when applicable:

```text
SITE_NAME
SITE_PROJECT_ID
SITE_URL
CODEX_WINDOW_TITLE_OR_CLASS
TASK_MODE
EXPECTED_SITES_VERSION
HANDOFF_PACKAGE
LOCAL_VALIDATION_RESULT
REVIEW_RESULT
```

Recommended `TASK_MODE` values:

```text
STATUS_ONLY
PRESERVE_DIFF_MERGE
SITE_SAVE
SITE_DEPLOY
DATA_SYNC
```

Do not place credentials, auth headers, browser cookies, bearer tokens, API keys, or private session material in the prompt, files, logs, or screenshots.

## Stable operator intents

Interpret these phrases as stable commands:

- `CODEX SITE STATUS` — open/focus Codex Desktop, submit a read-only `@site` status request, monitor, and report.
- `CODEX SITE PASTE` — paste a reviewed `@site` prompt into the Codex composer but do not submit.
- `CODEX SITE RUN` — paste and submit a reviewed non-destructive or explicitly authorized prompt.
- `CODEX SITE WATCH` — monitor an already-running Codex/Sites execution without changing it.
- `CODEX SITE MERGE` — run `PRESERVE + DIFF + MERGE`: inventory first, write only missing data, zero deletes by default.

## Safety defaults

Unless the user explicitly authorizes otherwise:

```text
DELETE production rows = forbidden
DELETE R2 objects = forbidden
clear/reset Production = forbidden
re-OCR reviewed files = forbidden
recompute reviewed financial amounts = forbidden
force an expected final global row count = forbidden
auto-resolve conflicts = forbidden
```

The default production data strategy is:

```text
PRESERVE + DIFF + MERGE
```

That means:

```text
existing valid Production data stays
→ inventory exact current state
→ compare against reviewed handoff
→ classify already-present / missing / conflict / uncertain
→ write missing only
→ zero deletes
→ verify package coverage and full Production separately
```

## Desktop preflight

Before automating the UI, detect the actual desktop target.

Recommended X11 checks:

```bash
wmctrl -lx
```

Typical Codex Desktop identification may resemble:

```text
_NET_WM_NAME = "ChatGPT"
WM_CLASS includes "codex-desktop"
```

Do not rely only on the visible title `ChatGPT`: verify the window class/process belongs to Codex Desktop.

If multiple candidate windows exist and the target cannot be identified unambiguously:

```text
BLOCKED
```

Do not click or paste into an ambiguous window.

## Composer verification

Before paste/submit, obtain a screenshot of the candidate window and verify:

```text
Codex Desktop is visible
Codex mode is selected or available
composer is visible
no unrelated app/window has focus
```

If the UI is not in the expected state, stop instead of sending blind keystrokes.

## Clipboard strategy

Preferred order:

```text
xclip / xsel if already installed
→ desktop clipboard API already available
→ Python GTK clipboard owner
```

Do not install packages just to perform a one-time paste unless the operator explicitly wants that system change.

A GTK clipboard helper may hold the clipboard in memory:

```python
import gi
from pathlib import Path

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gdk

text = Path("/tmp/sites-prompt.txt").read_text(encoding="utf-8")
clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
clipboard.set_text(text, -1)
clipboard.set_can_store(None)
clipboard.store()
Gtk.main()
```

The clipboard process may need to remain alive until paste completes.

Never place credentials or secrets in the clipboard payload.

## X11 paste strategy

If `xdotool` is not installed but Python `Xlib` is available, XTEST may be used to:

```text
activate exact Codex Desktop window
click inside verified composer coordinates
press Ctrl+V
```

Always separate **paste** and **submit** into two observable steps:

```text
1. paste
2. screenshot and verify text is in the correct composer
3. submit only after verification
```

Do not combine blind click + paste + Enter in a single unverified action.

## Prompt shape

A Codex Sites task should start with an explicit Sites intent, for example:

```text
@site 連薪總署
```

Then provide exact identifiers and safety constraints:

```text
SITE: <site-name>
SITE_PROJECT_ID: <project-id>

ACTION:
...

SAFETY:
...
```

For data reconciliation, explicitly say:

```text
PRESERVE + DIFF + MERGE
PLANNED_DELETES: 0
```

## Production freshness/API gate

Before any Production data write, require a read-only authenticated probe.

For the current portfolio API pattern:

```text
GET /api/portfolio
```

Require the expected current-version shape, such as:

```text
totals is an object
importsUsed is an array
availableDates is an array
```

If any of the following occurs:

```text
401
403
old API shape
wrong Sites version
freshness mismatch
wrong project identity
```

then:

```text
BLOCKED
Production writes = 0
```

Do not continue because the prompt "looks right".

## PRESERVE + DIFF + MERGE workflow

Use this whenever Production already contains data and a reviewed handoff package needs to be merged.

### 1. BEFORE inventory

Read current Production without mutation.

For imports, retrieve as much of the following as the API/control plane supports:

```text
id
filename
file_hash
source_kind
as_of_date
status
row_count
```

For positions, summarize by:

```text
import_id
source_kind
as_of_date
position_count
cost_basis
market_value
pnl
dividend
```

For OCR, inspect available identity evidence such as:

```text
id
filename
object_key
sourceSha256 when preserved in metadata
raw/extracted identity fields when safely readable
```

For snapshots, enumerate snapshot dates when supported.

### 2. Import classification

Use the server's real idempotency semantics. For a Version-3 portfolio importer this may be:

```text
fileHash + sourceKind + asOfDate
```

Classify each package import:

```text
ALREADY_PRESENT
MISSING
CONFLICT
```

Rules:

- `ALREADY_PRESENT` → do not POST again.
- `MISSING` → eligible for write after all gates pass.
- `CONFLICT` → do not overwrite/delete; stop that item and report evidence.

### 3. OCR classification

OCR APIs may not have a strong server-side idempotency key.

Therefore classify:

```text
ALREADY_PRESENT
MISSING
UNCERTAIN
```

Use available identity evidence such as filename, object key, stored source SHA-256, and reviewed metadata.

Rules:

- Proven present → do not upload again.
- Proven missing → eligible for upload.
- Uncertain → do not guess and do not re-upload automatically.

Never re-OCR a reviewed file merely to make matching easier.

### 4. Snapshot classification

For each reviewed snapshot date:

```text
already exists → verify only
missing + corresponding portfolio totals verified → create
conflict/uncertain → stop and report
```

### 5. Required DIFF PLAN before write

Before any write, require a human-readable plan:

```text
EXISTING_IMPORTS:
MISSING_IMPORTS:
CONFLICT_IMPORTS:

EXISTING_OCR:
MISSING_OCR:
UNCERTAIN_OCR:

EXISTING_SNAPSHOTS:
MISSING_SNAPSHOTS:

PLANNED_D1_WRITES:
PLANNED_R2_WRITES:
PLANNED_DELETES: 0
```

If the tool cannot prove the intended write set, stop.

### 6. Minimum write

Write only `MISSING` items.

Do not modify already-present items solely to make totals or row counts equal the package's standalone counts.

### 7. Dual verification

After merge, verify two different scopes:

```text
PACKAGE-SCOPE VERIFY
PRODUCTION-SCOPE VERIFY
```

Package scope answers:

```text
Did the reviewed handoff package become fully represented in Production?
```

Production scope answers:

```text
What is the actual complete Production state after merge?
```

Do not require the two scopes to have identical totals if Production legitimately contains additional historical sources.

## Package attachment rule

A filename written in a prompt is not proof that the binary attachment is available to Codex Desktop or `@site`.

Before writing package data, verify the handoff package is actually accessible in the current Codex task.

If the agent reports that only the filename is known but the file is not attached/accessible:

```text
continue read-only inventory if useful
but do not fabricate package contents
and do not perform package-dependent writes
```

Valid next actions include:

```text
attach the real ZIP/file to the Codex task
or use another authorized file transfer path that preserves exact bytes
```

Never reconstruct a binary package from a narrative summary when exact file hashes matter.

## Submission gate

`CODEX SITE PASTE` stops after screenshot verification.

`CODEX SITE RUN` may press Enter only when:

```text
exact Codex Desktop window verified
composer verified
prompt content verified
prompt contains no secrets
requested action is within current authorization
```

For destructive operations, the prompt must contain explicit user authorization for the exact destructive action. Otherwise do not submit destructive instructions.

## Monitoring

After submission, take periodic screenshots or inspect accessible status text.

Track progress such as:

```text
step 1/5
inventory
freshness gate
DIFF PLAN
write phase
verification
```

Do not infer success from elapsed time or a spinner disappearing.

Useful positive evidence includes:

```text
Sites source/tool visibly attached
Production version explicitly identified
authenticated API probe returned expected shape
DIFF PLAN emitted
write counts reported
final read-back reported
```

If the agent enters a blocked state, surface the blocker rather than repeatedly pressing Enter or resubmitting the same prompt.

## Result report

A completed run should report:

```text
RESULT: PASS | PARTIAL | BLOCKED
SITE:
SITE_PROJECT_ID:
PRODUCTION_VERSION:
AUTHENTICATED_PREFLIGHT: PASS | FAIL
API_SHAPE: PASS | FAIL

BEFORE_IMPORTS:
BEFORE_POSITIONS:
BEFORE_OCR:
BEFORE_SNAPSHOTS:

PACKAGE_EXISTING_IMPORTS:
PACKAGE_NEW_IMPORTS_WRITTEN:
PACKAGE_CONFLICT_IMPORTS:

PACKAGE_EXISTING_OCR:
PACKAGE_NEW_OCR_WRITTEN:
PACKAGE_UNCERTAIN_OCR:

PACKAGE_EXISTING_SNAPSHOTS:
PACKAGE_NEW_SNAPSHOTS_WRITTEN:

D1_WRITES:
R2_WRITES:
DELETES: 0

PACKAGE_COVERAGE:
PRODUCTION_TOTALS:
FINAL_VERIFY: PASS | FAIL
```

## Failure modes

### Wrong desktop window

```text
BLOCKED
Do not paste.
```

### Prompt pasted into wrong composer

Do not submit. Clear only the accidental composer content if doing so is unambiguous and non-destructive; otherwise stop and ask the operator to correct focus.

### @site unavailable

Do not replace `@site` with browser scraping or guessed API credentials. Report the capability gap.

### Authenticated API returns 401/403

Stop before any write.

### Package missing from task

Inventory may continue read-only, but package-dependent writes are blocked.

### Production already has extra data

Do not clear Production. Use package coverage rather than global row-count equality.

### OCR identity uncertain

Do not re-upload automatically.

### Conflict in financial amounts

Do not overwrite or recompute. Report the exact conflicting source/date/amounts.

## Relationship with other Sites skills

Use `chatgpt-sites-local-development` for source-tree lifecycle:

```text
Sites saved source
↔ local canonical source
↔ GitHub
↔ Sites Save
↔ exact Deploy
```

Use this skill for the desktop control path:

```text
DC
→ Codex Desktop
→ @site
→ observed Sites execution
```

Repository/project-specific Sites skills remain authoritative for project paths, known SHAs, build/test commands, and deploy-specific requirements.

## Recommended completion definition

`CODEX SITE RUN` is complete only when:

```text
1. correct Codex Desktop task received the exact reviewed prompt
2. @site actually engaged the Sites capability
3. required read-only gates passed
4. any write stayed inside the authorized minimum delta
5. final Production state was read back and reported
```

If only steps 1-2 occurred, report `RUNNING`, not `PASS`.

## Core safety invariants

```text
window title alone is not enough to identify Codex Desktop
paste is not submit
submit is not Sites success
Sites success is not proof without read-back
filename is not attachment
existing Production data must not be deleted to satisfy package standalone counts
OCR uncertainty must not be resolved by guessing
credentials must never be extracted or logged
minimum-delta write is preferred over reset/rebuild
```

When any required identity, attachment, freshness check, authorization, or final verification cannot be proven, stop with `BLOCKED` rather than guessing.
