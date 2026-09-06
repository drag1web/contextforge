# Contributing to ContextForge

Thanks for helping improve ContextForge. Contributions are most useful when they are focused, evidence-based, and preserve the product's local-first safety boundaries.

## Project status

ContextForge is an alpha-stage local-first desktop developer tool. `main` is the canonical development branch, and v0.7.x is the active alpha line.

Context Engine V2 Phase A2 is frozen. Further CE2 semantic work must not be changed casually and must follow the diagnosis, validation, and rollout boundaries in [`docs/CONTEXT_ENGINE_V2_ROADMAP.md`](docs/CONTEXT_ENGINE_V2_ROADMAP.md). The CE2 global default is not enabled.

## Before opening a contribution

- Search existing issues before opening a new one.
- Keep the proposed scope focused.
- Open an issue before implementing substantial architectural work.
- Avoid bundling unrelated cleanup or refactoring with the intended change.
- Never include real secrets, private source, absolute local paths, private validation manifests, API tokens, raw AI prompts or responses, credentials, or private repository data.

## Development setup

Requirements:

- Node.js 20 or newer;
- npm.

Install and run the project:

```bash
npm install
npm run dev
npm run build
```

Normal desktop development is SQLite-first and does not require Docker. Ollama, GitHub, and other external providers are optional integrations, not development prerequisites.

## Validation

Run checks that are relevant to the files and behavior you changed. At minimum for code changes, start with:

```bash
npm run build
npm run test:repository-hygiene
```

Selector, grounding, Task Pack, authorization, MCP, or backend changes may require the corresponding focused smoke commands listed in `package.json`. A documentation-only change does not need every unrelated smoke suite. Report only commands you actually ran; GitHub CI remains the authoritative complete repository gate.

## Contribution scope rules

- Work from real repository files and inspect the current implementation before editing.
- Preserve local-first and privacy boundaries.
- Do not weaken safety or authorization checks to make a test pass.
- Do not hardcode real-project-specific fixes into universal engine logic.
- Do not widen MCP permissions casually.
- Do not add automatic repository edits, shell execution, Git mutation, or automatic pull-request behavior without an explicitly approved product change.
- Preserve fail-closed behavior wherever existing contracts require it.

## Context Engine V2 changes

The frozen CE2 checkpoint and deferred work are documented in the [Context Engine V2 roadmap](docs/CONTEXT_ENGINE_V2_ROADMAP.md). CE2 semantic changes require diagnosis before implementation. Real projects may reveal defects, but they must not define universal architecture. Implementation, global-default rollout, and physical legacy retirement are separate decisions with separate gates.

## Pull requests

- Use a short-lived branch or fork and open the pull request against `main`.
- Use a focused title and summarize the outcome clearly.
- List the files or areas changed and identify what remains out of scope.
- Include the verification you actually performed.
- Include screenshots when visible UI behavior changed.
- Disclose privacy or security implications, including changes to local data handling or external integrations.
- Do not claim that a test or check passed unless you ran it.

## Reporting security issues

Follow [`SECURITY.md`](SECURITY.md) and use the repository's private GitHub Security Advisory flow. Do not report vulnerabilities involving credentials, secrets, private source, local paths, MCP authorization, or external-account credentials in public issues.
