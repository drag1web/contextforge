# Validation Lab

Validation Lab is a read-only batch runner available on the **Reports** page.
It replaces repeated manual entry of validation prompts while preserving the
same Task Understanding and Context Composer preview pipeline used by the main
Task Pack flow.

## Safety and scope

- Tests run sequentially against one project selected in the UI.
- The runner never edits project files, generates a Task Pack, or executes
  generated code.
- Test IDs, task text, project paths, clarifications, and expectations live in
  the uploaded manifest. The runtime contains no project-specific cases.
- Diagnostic exports omit source snippet contents and retain only snippet
  metadata.
- A manifest may contain up to 50 cases and may be saved as `.json` or `.txt`.

## Workflow

1. Open **Reports → Validation Lab**.
2. Download **Manifest template** or upload an existing manifest.
3. Select any scanned project.
4. Run the suite. Cases are processed one at a time.
5. ContextForge automatically downloads a ZIP archive when the run finishes.

The archive contains:

- `report.txt` — readable run report;
- `results.json` — machine-readable summary;
- `input/manifest.json` — normalized input;
- `diagnostics/<case-id>.json` — one diagnostic record per case;
- `README.txt` — archive map and safety statement.

## Manifest behavior

`defaults.acceptReview` is `true` unless explicitly disabled. When Task
Understanding requests review, the runner may acknowledge the exact snapshot
created for that case. Required clarification is never guessed: add recorded
question/answer pairs to `clarifications`, or the case stops after Task
Understanding and reports the unresolved state.

Cases without `expect` are marked `observed`. Cases with expectations are
marked `passed` or `failed`. Disabled and post-cancellation cases are marked
`skipped`; request/API failures are marked `error`.

Supported expectations:

- understanding readiness and interaction action;
- context quality status and score range;
- effective task area and execution mode;
- selected paths (contains or exact mode);
- paths that must remain excluded;
- exact authorized edit targets;
- maximum warning count and case duration.

Use **Stop after current case** for safe cancellation. The active request is
allowed to finish; remaining cases are recorded as skipped.
