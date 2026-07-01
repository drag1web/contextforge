# ContextForge v0.5.2 — Page Semantic Targets Patch

## Goal

Improve route/page file selection for natural language tasks without adding project-specific or business-domain hardcoding.

This patch keeps the universal ContextForge rule: the scanner and selector use real project inventory, file structure, page metadata/headings/text hints, imports, and user constraints. No rules are tied to `metall-perm`, `cyberteam`, or any known project.

## What changed

### 1. Page semantic target matching

ContextForge now gives concrete page files higher priority when the user's task describes a page/section/screen in natural language.

The selector can match page targets using real evidence from inventory:

- route path and path segments;
- file role and filename;
- symbols and exports;
- scanner text hints;
- page-level metadata/title/description;
- visible headings such as `h1`, `h2`, `h3`;
- page-local text snippets.

Example target behavior:

- task mentions a page with requisites/details → a real page file whose headings/metadata contain matching text is selected first;
- task mentions services page → a real services page is selected before generic UI primitives.

### 2. Scanner extracts stronger page hints

`projectInventoryScanner.ts` now extracts page-level semantic hints from readable source files:

- `title: "..."`;
- `description: "..."`;
- `aria-label`, `label`, `heading`, `subtitle`-style values;
- JSX headings: `<h1>`, `<h2>`, `<h3>`.

These hints are boosted into `textHints` so fallback selection can use them even when Ollama returns invalid or empty JSON.

### 3. Concrete page target beats broad UI fallback

When a concrete page target is found, broad fallback candidates are skipped for specific page/file tasks.

This prevents generic files like these from becoming primary edit targets just because the task is UI-related:

- `Button.tsx`;
- `Input.tsx`;
- `Textarea.tsx`;
- broad form/lead components;
- app shell/entrypoint files.

Relevant imported local files may still be included as supporting context. Generic UI primitives remain `inspect-only`; route-local page components or imports that clearly match the requested page scope may be marked `inspect-and-edit`.

### 4. Safer protected constraint handling

Protected constraints now distinguish stable file identity from random text/links inside a page.

A page is not rejected just because it contains a link to a protected page such as contacts, policy, consent, or delivery. Stable identity signals are used for protection checks:

- path;
- filename;
- role;
- routePath.

This avoids false exclusions of the correct page target.

### 5. Page target guardrails

The selector now avoids treating these as concrete page targets for normal page/UI tasks:

- root proxy page unless the task is clearly about home/landing/main page;
- API route files such as `route.ts` or files under `/app/api/`;
- layout/app-shell/global/SEO files when the task says not to touch them.

## Verification

Ran:

```bash
npm run build -w @contextforge/server
npm run test:selector -w @contextforge/server
npm run build
```

Result: TypeScript build and selector smoke tests passed.

Smoke checks on the uploaded metall site inventory:

- task about the requisites page selected `src/app/(site)/requisites/page.tsx` first;
- task about the services page selected `src/app/(site)/services/page.tsx` first;
- generic UI components were included only as `inspect-only` references when imported by the selected page;
- forbidden pages/layout/globals/SEO files were not selected as edit targets.

Additional local smoke coverage now checks:

- semantic page target selection;
- route-local imported components can remain editable when they match the selected page scope;
- Header/navigation tasks prioritize the concrete component over broad global CSS;
- explicit Russian file tasks such as `В файле src/components/Header.tsx ... не менять остальные файлы` keep the named file selected and do not enter blocked review mode;
- Russian `но ... не трогать` constraints protect only the trailing forbidden clause instead of swallowing the positive page target;
- protected API terms do not select API files as editable UI targets;
- `.env` files are not read into inventory, while `.env.example` remains readable with sensitive values redacted.

## Files changed

- `server/src/ollama/taskFileSelector.ts`
- `server/src/scanner/projectInventoryScanner.ts`
- `server/src/selection/contextQuality.ts`
- `server/src/ollama/taskFileSelector.smoke.ts`
- `server/package.json`
- `package.json`
