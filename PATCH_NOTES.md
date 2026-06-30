# ContextForge v0.5.2 — Negative Route Cleanup Patch

## Goal

Improve file selection without adding project-specific domain rules.

This patch does **not** hardcode known projects such as metall-perm, cyberteam-frontend, License Monitor, GameHub, Faceit, Steam, or portfolio projects.
It does **not** map a business/domain word to a concrete file path.

The changes are universal and inventory-driven:

- parse user constraints from the task text;
- separate positive target text from negative "do not touch" clauses;
- validate every selected file against the real inventory;
- infer route/page candidates from real route files and route metadata;
- avoid SEO/system files unless the task is explicitly about SEO/metadata.

## What changed

### 1. Stronger negative constraints

Examples now handled better:

- `API-запросы не менять`
- `логику загрузки, удаления и остальные компоненты не менять`
- `не трогай каталог, шапку, футер, контакты, юридические страницы и глобальные стили`

Protected terms are expanded through generic technical vocabulary only:

- API/request/fetch/axios;
- component/shared/ui;
- table/list/grid/catalog;
- header/nav/footer/contact/legal/style/global.

Matching protected files are removed from editable candidates unless the file was explicitly selected as the user's positive target.

### 2. Natural route/page resolver

ContextForge can now infer route/page candidates from natural wording, not only explicit `/route` mentions.

Examples:

- `раздел про доставку`
- `страница настроек`
- `страница пользователя`

The resolver scores real inventory route/page files using:

- `routePath`;
- path segments;
- file role (`page`);
- text hints/content preview;
- a small generic multilingual website/app section vocabulary.

It does not hardcode concrete project files.

### 3. Route-scoped noise cleanup

When the task is route/page-specific, unrelated page/global/component candidates are filtered unless they match:

- explicit user file mention;
- route match;
- strong positive task tokens;
- secondary docs deliverable.

This prevents generic `Button.tsx`, unrelated catalog components, global styles, and random page files from being selected just because they have plausible technical roles.

### 4. SEO/system file penalty

Files like these are excluded/penalized for normal UI/general tasks:

- `robots.ts`
- `sitemap.ts`
- `manifest.*`
- `metadata.*`

They are still allowed when the positive task asks for SEO, sitemap, robots, metadata, indexing, or build/config work.

### 5. Explicit-file tasks stay narrow

When the user explicitly names a file and protects other logic/components, ContextForge avoids adding low-value docs/data candidates unless docs are a positive secondary deliverable.

## Local verification performed

- Ran server TypeScript build:

```bash
npm run build -w @contextforge/server
```

- Ran selector smoke checks with synthetic inventories for:

1. `src/components/UsersTable.js` + `API-запросы не менять`
   - selected only `src/components/UsersTable.js` as edit target;
   - did not select `src/api/api.js`.

2. `раздел про доставку` + protected catalog/header/footer/contacts/legal/global styles
   - selected the delivery page route as edit target;
   - did not select catalog component, globals, robots, sitemap, contacts, or legal pages.

## Recommended real tests

### Test 1 — cyberteam-frontend

```text
Нужно в src/components/UsersTable.js аккуратно улучшить внешний вид формы добавления пользователя: сделать поля и кнопку визуально ровнее, добавить нормальные отступы и чтобы блок не выглядел как черновик. Логику загрузки, удаления, API-запросы и остальные компоненты не менять.
```

Expected:

- `src/components/UsersTable.js` first;
- no `src/api/api.js` as `inspect-and-edit`;
- no unrelated tables/components;
- not blocked.

### Test 2 — metall-perm

```text
На сайте металлки в разделе про доставку текст и блоки выглядят слишком сухо и неубедительно. Надо сделать страницу понятнее для клиента: чуть лучше структура, акценты, визуально приятнее, но не трогай каталог стали, шапку, футер, контакты, юридические страницы и глобальные стили.
```

Expected:

- delivery page route first;
- no `SteelCompact.tsx`;
- no `globals.css`;
- no `robots.ts` / `sitemap.ts`;
- no header/layout/contacts/legal page files;
- not blocked.
