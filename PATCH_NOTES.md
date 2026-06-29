# ContextForge v0.5.2 — Polarity & Route Resolver Patch

## Purpose

This patch tightens the file-selection core after the balanced/context-noise pass.
It focuses on two remaining problems:

1. Negative constraints like “do not touch README/API/tables/routes” must not become target hints.
2. Page/route tasks like `/steel` should prefer the route page and colocated route components before generic global styles or shared UI primitives.

## Changed files

- `server/src/ollama/taskFileSelector.ts`
- `server/src/selection/contextQuality.ts`

## What changed

### 1. Positive target text vs negative constraints

The selector now separates:

- positive task text: what the user wants changed;
- negative constraint phrases: what the user explicitly forbids changing.

Examples:

```text
Блин, меню выглядит деревянно. Нужно улучшить навигацию в App.js.
Но не лезь в таблицы, API, README и роуты не меняй.
```

Positive target signals:

- `App.js`
- `меню`
- `навигация`
- `внешний вид`

Negative/protected signals:

- `таблицы`
- `API`
- `README`
- `роуты`

The negative words are used to exclude/protect files, not to select docs/API/table targets.

### 2. Explicit file resolution now ignores negated file mentions

`README.md` inside “не трогай README.md” should not be treated as a primary explicit target.
The selector and quality gate now resolve explicit files against positive task text.

### 3. Route-aware file selection

The selector now detects route mentions such as:

```text
/steel
/users
/admin/settings
```

Then it boosts real inventory files matching that route, including:

- route files such as `src/app/**/steel/page.tsx`;
- colocated route components such as `src/app/**/steel/*.tsx`;
- related files whose route metadata/path/text hints match the route segment.

This is generic route logic, not project-specific domain logic.

### 4. Global styles are no longer allowed to dominate page-specific tasks

For page/component-specific UI tasks, `globals.css`, `index.css`, and `App.css` are deprioritized unless the task explicitly asks for global theme/styles.

### 5. General/default task type is safer

The user may leave the default `general` task type. The effective task area now relies more on positive task text, explicit files, and route mentions, so tasks like “improve navigation in App.js” should still infer UI even if the template is general.

## Expected retests

### Ordinary test

```text
В файле src/App.js улучшить навигацию и не менять остальные файлы
```

Expected:

- `src/App.js` only or first;
- no blocked;
- no table/API/README noise.

### Non-standard test

```text
Блин, меню в приложении выглядит деревянно. Надо аккуратно улучшить верхнюю навигацию в App.js: активный пункт, hover, отступы, чтобы выглядело приятнее. Но не лезь в таблицы, API, README и роуты не меняй — только внешний вид меню.
```

Expected:

- `src/App.js` first;
- optional style file only if useful;
- no README/API/table components as targets;
- no blocked.

### Route/page test

```text
Я не помню, где именно сделан каталог марок стали, но на странице /steel нужно заменить текущий длинный список позиций на нормальную таблицу. Шапку, футер, контакты, доставку и юридические страницы не трогать. Если найдёшь отдельный компонент каталога — меняй только его.
```

Expected:

- route/page or route-colocated catalog component near the top;
- no header/footer/contact/delivery/legal pages as edit targets;
- `globals.css` should not be first unless global styles were explicitly requested;
- no blocked.

## Verification

A temporary local `sql.js` type stub was used only for type-checking this sandbox copy because the archive lacks the Linux-compatible `sql.js` package/types. With that stub, server TypeScript passed:

```bash
npx tsc --noEmit --pretty false -p server/tsconfig.json
```

In the real project, run:

```powershell
npm run build -w @contextforge/server
npm run dev
```
