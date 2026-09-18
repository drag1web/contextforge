# ContextForge v0.8 — Task Pack Lifecycle & Versioning Data Contract Audit

> Audit: `TP-LC-00`
>
> Repository baseline: `main` at `e4b9b6d9a90816a5b0e9f437ab5c8fc4334df6a6`
>
> Product line: `0.7.1-alpha` → proposed `v0.8.x` work
>
> Scope: architecture and compatibility audit only; no lifecycle, persistence, API, renderer, MCP, or Context Engine v2 implementation is included.

## Evidence vocabulary

This document uses four explicit evidence labels:

- **CURRENT FACT** — directly evidenced by the named source file, type, route, or schema.
- **DERIVED FACT** — a conclusion that follows from multiple current facts; it is not a new product contract.
- **PROPOSAL** — recommended future behavior for a bounded v0.8 work order.
- **NOT CURRENTLY AVAILABLE** — data or behavior that the current repository does not provide.

Paths are repository-relative. Symbol and field names are written exactly as they exist at the audited baseline.

## 1. Executive summary

**CURRENT FACT.** A Task Pack is currently one mutable row in `task_packs`. Its canonical local identity is the adapter-assigned numeric `TaskPackRecord.id`. The row contains the task, generated prompt, generation metadata, a JSON generation recipe, and two timestamps. There is no persisted revision, lifecycle, review, parent/root, draft, completion, acceptance, or archive identity.

**CURRENT FACT.** `PATCH /task-packs/:id/content` overwrites `raw_task` and/or `generated_prompt` in that row. Internal operations also overwrite `generation_recipe`: post-generation performance diagnostics and a created GitHub issue link both update the existing row. `updatedAt` therefore means “last row mutation”, not “content revision created”, “reviewed”, or “completed”.

**DERIVED FACT.** The current row can become historically inconsistent: a user may replace `rawTask` or `generatedPrompt` while `generationRecipe.selectorDiagnostics`, `generationDiagnostics`, template/rule selections, and generation metadata still describe the earlier generation. The original values are not recoverable through storage.

**CURRENT FACT.** A renderer `TaskPackDraft` is transient React/navigation state. It has no `id`, persistence timestamp, server record, or concurrency token. The “Task Pack archive” is the saved-pack library in `TaskPacksPage`; there is no archived state or archive endpoint.

**Recommendation — architecture B.** Introduce a stable Task Pack aggregate identity backed by immutable `TaskPackRevision` records. Keep drafts as a separate persisted working resource, and keep review/lifecycle transitions in append-only events rather than mutating revision payloads. Existing `taskPackId` remains the default identity for HTTP and MCP clients; omitting a revision continues to mean the current revision.

The recommended model separates three concerns that a single status enum would conflate:

1. **Working state:** a mutable, explicitly saved `TaskPackDraft` with its own identity and optional `baseRevisionId`.
2. **Historical content:** immutable `TaskPackRevision` snapshots containing the task, output, recipe, diagnostics, grounded context metadata, and generation provenance.
3. **Product workflow:** a stable Task Pack aggregate with `active`, `completed`, or `archived` lifecycle projection, plus revision review events such as `review_started`, `accepted`, and `changes_requested`.

No proposal in this audit changes Context Engine v2 selection, grounding, authorization, rollout, or defaults.

## 2. Current architecture

### 2.1 Canonical identity and ownership

| Finding | Evidence |
|---|---|
| **CURRENT FACT:** local identity is a numeric integer | `TaskPack.id` in `apps/desktop/renderer/src/types/index.ts`; `TaskPackRecord.id` in `server/src/storage/types.ts`; SQLite `id INTEGER PRIMARY KEY AUTOINCREMENT` in `server/src/storage/SqliteStorageAdapter.ts`; PostgreSQL `id SERIAL PRIMARY KEY` in `server/src/storage/PostgresStorageAdapter.ts`. |
| **CURRENT FACT:** the project relationship is required | `projectId`/`project_id` is non-null; both schemas use `ON DELETE CASCADE`. Deleting a project at the database level deletes its Task Packs. There is no independent cross-project Task Pack identity. |
| **CURRENT FACT:** `projectName` is not stored on the Task Pack row | Both adapters join `projects` and reconstruct `projectName` in `listTaskPacks()` and `getTaskPackById()`. |
| **DERIVED FACT:** the numeric ID is installation-local, not portable | Workspace backup emits the ID as ordinary row data; cloud publish converts it to `sourceTaskPackId: String(taskPack.id)` and separately tracks `originInstallationId`. Cloud import creates a new local row with a new numeric ID. |
| **NOT CURRENTLY AVAILABLE:** stable revision identity | No `revisionId`, `revisionNumber`, `rootId`, `parentId`, or `baseRevisionId` exists in the renderer, storage adapter, HTTP routes, or MCP contract. |

Cloud handoff is a separate identity domain. `apps/desktop/renderer/src/types/desktopSync.ts` defines `DesktopSyncCloudTaskPack.id`, `originInstallationId`, and `sourceTaskPackId`; `apps/desktop/electron/desktop-sync.cjs` hashes a flat upload payload. `POST /task-packs/import` in `server/src/routes/taskPacks.ts` de-duplicates by a `generationMessage` marker containing the delivery ID, then creates a new local Task Pack with `generationRecipe: null`. It does not preserve a first-class source aggregate or revision foreign key.

### 2.2 Creation and mutation flow

**CURRENT FACT.** The primary creation route is `POST /task-packs`, implemented by `createTaskPackWithPipeline()` in `server/src/routes/taskPacks.ts`. It:

1. resolves Task Understanding and context selection;
2. enforces execution authorization;
3. builds a grounded template prompt;
4. optionally performs guarded AI refinement through `generateReliableTaskPack()`;
5. creates a `TaskPackGenerationRecipe` containing template/rule/criteria metadata plus selector and generation diagnostics;
6. inserts one `task_packs` row;
7. subsequently updates that row to attach `performanceDiagnostics`.

**CURRENT FACT.** The writable surfaces are:

- `StorageAdapter.createTaskPack()` — inserts the complete row;
- `StorageAdapter.updateTaskPackContent()` — overwrites only `rawTask` and/or `generatedPrompt` and advances `updatedAt`;
- `StorageAdapter.updateTaskPackGenerationRecipe()` — overwrites the entire recipe JSON and advances `updatedAt`;
- `POST /task-packs/:id/github/issue` — creates an external issue and overwrites the recipe with `githubCreatedIssue` added;
- `POST /task-packs/import` — creates a separate local row from a cloud delivery.

There is no update method for `title`, `taskType`, `targetTool`, project ownership, or generation scalar fields. The title is derived by `createTitle(rawTask)` at generation time and is not recalculated by `PATCH /:id/content`; editing `rawTask` may therefore leave an intentionally or unintentionally stale title.

**DERIVED FACT.** A Task Pack is mutable after creation, but mutation is partial and not modeled as a new historical event. There is no optimistic concurrency guard, expected revision, ETag, or conflict response.

### 2.3 Current meanings of “draft”, “generated”, “saved”, and “archived”

| Term | Current meaning |
|---|---|
| **Draft** | **CURRENT FACT:** `TaskPackDraft` in `apps/desktop/renderer/src/types/index.ts` is a client-side form value. `useDashboardController()` stores it with `useState`; `useWorkspaceNavigationHistory()` can retain copies in its in-memory entries. No Task Pack draft key is written to localStorage/sessionStorage and no draft endpoint exists. It has no persistence identity. |
| **Generated** | **CURRENT FACT:** a successful pipeline call immediately creates a stored Task Pack. `generationMode`, `generationModel`, `generationMessage`, `generationUsedFallback`, `generationDurationMs`, and `generationRecipe.generationDiagnostics` describe how the current row was initially produced. |
| **Saved** | **CURRENT FACT:** the row exists in SQLite/PostgreSQL. A local editor save overwrites the same row. There is no distinction between “generated but unsaved” and “saved generated” on the server. |
| **Reopened in Builder** | **CURRENT FACT:** `handleOpenTaskPackInBuilder()` constructs a new transient `TaskPackDraft` from the current Task Pack and recipe. Generating it calls `POST /task-packs` and creates a new unrelated Task Pack ID; no parent/revision link is recorded. |
| **Archived** | **CURRENT FACT:** `TaskPacksPage` labels the library as an archive and `TaskPackResultPage` navigates to it. There is no `archived` field, archived timestamp, filter, or transition. Every stored row is returned by `GET /task-packs`. |

## 3. Current persistence model

### 3.1 Canonical row

`TaskPackRecord` in `server/src/storage/types.ts` defines the current storage contract:

```text
id
projectId
projectName?                 # joined, not stored in task_packs
title
rawTask
taskType
targetTool
generatedPrompt
generationMode
generationModel
generationMessage
generationUsedFallback
generationDurationMs
generationRecipe
createdAt
updatedAt
```

`CreateTaskPackInput` contains the persisted content and generation fields. `UpdateTaskPackContentInput` contains only `rawTask?` and `generatedPrompt?`. `generationRecipe` is typed as `unknown | null` at the storage boundary, even though the renderer and route use a structured `TaskPackGenerationRecipe`.

### 3.2 SQLite

**CURRENT FACT.** `server/src/storage/SqliteStorageAdapter.ts` creates `task_packs` with the fields above. `generation_recipe` is serialized JSON text. `createTaskPack()` uses one ISO timestamp for `created_at` and `updated_at`. Both update methods overwrite the row and set a new `updated_at`. Listing is ordered by `created_at DESC`, not by last revision/update.

**CURRENT FACT.** SQLite schema metadata is versioned by `SQLITE_SCHEMA_VERSION = 2` and `SQLITE_MIGRATIONS` in `server/src/storage/migrations.ts`:

- `0001_sqlite_baseline` is a marker because compatibility tables are created before migrations;
- `0002_rules_templates_catalog` adds the rules/templates catalog.

`SqliteStorageAdapter.runMigrations()` applies definitions and records them in `schema_migrations`; the current runner is not an explicit per-migration `BEGIN IMMEDIATE`/`COMMIT` transaction boundary.

### 3.3 PostgreSQL

**CURRENT FACT.** `server/src/storage/PostgresStorageAdapter.ts` provides field-level Task Pack parity and uses `JSONB` for `generation_recipe`. It creates the base table and applies idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for generation fields.

**CURRENT FACT.** PostgreSQL does not expose the SQLite `getSchemaInfo()`/`schema_migrations` contract. DDL parity is currently maintained inside `ensureSchema()`, not by the versioned migration list in `server/src/storage/migrations.ts`.

**DERIVED FACT.** A lifecycle migration implemented only in `SQLITE_MIGRATIONS` would silently break adapter parity. A v0.8 implementation needs one logical migration contract with SQLite and PostgreSQL implementations, even if their DDL runners remain adapter-specific initially.

### 3.4 Persisted versus reconstructed data

| Data | Current treatment |
|---|---|
| Raw task and generated prompt | **CURRENT FACT:** persisted directly and currently mutable. |
| Template, rule profile, enabled/custom rules, acceptance criteria, clarifications | **CURRENT FACT:** persisted inside `generationRecipe` when generated locally. Imported/older Task Packs may have `generationRecipe: null`. |
| Selector and generation diagnostics | **CURRENT FACT:** persisted inside `generationRecipe` for the generated row. A separate bounded selector history (`selector_diagnostics_history`, limit 50) is stored in app settings by `server/src/settings/settingsService.ts`; it has no Task Pack foreign key. |
| Final execution/authorization contract | **NOT CURRENTLY AVAILABLE as a dedicated persisted Task Pack field.** The current `TaskPackGenerationRecipe` type has no top-level `executionContract`; MCP explanation therefore truthfully falls back to `"unavailable"` when it is absent. Selected usages and safety outcomes can be partially reconstructed from selector diagnostics, but that is not a complete historical authorization snapshot. |
| Performance diagnostics | **CURRENT FACT:** attached in a second recipe update after creation. This update changes `updatedAt`. |
| CE2 shadow/canary/primary diagnostic histories | **CURRENT FACT:** stored as separate bounded settings histories. The Task Pack schema does not contain a stable foreign key to those history entries. This audit does not propose changing CE2. |
| Selected paths and usages | **CURRENT FACT:** reconstructed from `generationRecipe.selectorDiagnostics.actual.selectedFiles`; they are not relational rows. |
| Project name | **CURRENT FACT:** joined from the current `projects` row. Historical project naming is not frozen in the Task Pack. |
| Freshness | **CURRENT FACT:** derived in the renderer by `apps/desktop/renderer/src/utils/taskPackFreshness.ts`; not persisted. |
| Freshness basis | **CURRENT FACT:** uses `taskPack.id`, `projectId`, `createdAt`, selected paths from recipe diagnostics, and the current/previous Project Awareness observation. **NOT CURRENTLY AVAILABLE:** a revision-specific awareness observation ID or repository snapshot fingerprint. |
| `generationCached` | **CURRENT FACT:** optional on renderer `TaskPack`, but not a storage column. Cache state is available in modern `generationRecipe.generationDiagnostics.cached`. |
| Publish status | **CURRENT FACT:** transient `publishStateById` UI state; it is not a Task Pack lifecycle state. |
| Review, acceptance, completion, archive | **NOT CURRENTLY AVAILABLE.** |

## 4. Current API model

The current HTTP Task Pack boundary is concentrated in `server/src/routes/taskPacks.ts` and consumed by `apps/desktop/renderer/src/api/client.ts`.

| Endpoint | Current contract and lifecycle implication |
|---|---|
| `GET /task-packs` | Returns every stored Task Pack as a full flat row. There is no pagination, lifecycle filter, revision summary, or HTTP get-by-ID route. |
| `POST /task-packs` | Runs the guarded pipeline and immediately persists one Task Pack. A blocked or clarification-required selection returns `422`; no draft is created. |
| `POST /task-packs/understand` | Returns Task Understanding/context preparation data but creates no persistent draft or Task Pack identity. |
| `PATCH /task-packs/:id/content` | Validates and overwrites `rawTask` and/or `generatedPrompt`. It returns the same ID and no revision metadata. |
| `POST /task-packs/:id/github/issue` | Creates the issue and mutates the existing recipe to attach `githubCreatedIssue`. |
| `POST /task-packs/import` | Imports a flat cloud Task Pack as a new local row. It preserves task/prompt fields but not generation recipe/diagnostics or source revision identity. |

**CURRENT FACT.** `createTaskPackSchema` carries generation inputs including selected files, clarifications, template/rule/criteria IDs, and a GitHub issue source. None is a draft or revision identifier.

**CURRENT FACT.** The API has no delete, archive, complete, accept, compare, history, restore, or split endpoint.

**Compatibility risk.** Existing consumers expect the flat `TaskPack` shape. Replacing it with `{ aggregate, revision }` in one release would break the renderer, workspace search, Quick Peek/Inspector, Desktop Sync, MCP adapters, tests, and any private clients. API evolution must retain a flat current-revision projection.

## 5. Current renderer model

### 5.1 Builder

`TaskPackBuilderPage` receives a `TaskPackDraft` and reports the full updated value through `onChange`. The parent stores it in `useDashboardController` and navigation history. The draft includes:

- project identity/name;
- `rawTask`, `taskType`, and `targetTool`;
- template/profile/rule/acceptance-criteria choices;
- clarification and Task Understanding snapshot IDs;
- a performance session ID.

**CURRENT FACT.** It does not include `id`, `taskPackId`, `baseRevisionId`, `createdAt`, `updatedAt`, autosave state, or conflict token. Closing/navigating can clear it; application restart cannot restore it from a Task Pack draft store.

### 5.2 Result and editing

`TaskPackResultPage` stores the current flat `TaskPack` in component state. `TaskPackEditorDrawer` edits either `rawTask` or `generatedPrompt`; `handleSaveEditor()` calls `updateTaskPackContent()`. The editor displays “saved local” based on `updatedAt !== createdAt`, which cannot distinguish a user content edit from the internal performance-recipe or GitHub-link update.

Opening an existing pack in Builder first saves a changed raw task, then creates a transient draft. Regeneration creates a second unrelated Task Pack instead of a revision.

### 5.3 List, search, dashboard, Quick Peek, and Inspector

- `TaskPacksPage` treats each row as one card keyed by `taskPack.id`, sorts primarily from `createdAt`, and exposes open/copy/export/publish/peek/inspect actions. “Archive” is library copy, not state.
- `DashboardHomePage` and `components/dashboard/RecentTaskPacks.tsx` show recent rows, not aggregates or revisions.
- Global Search results identify Task Packs by the same numeric ID.
- `QuickPeekPanel` and `PersistentInspectorPanel` receive one flat current `TaskPack`; they show task, prompt or metadata and timestamps but no historical selector.
- `useWorkspaceNavigationHistory` compares Task Pack result locations only by `taskPack.id`; it stores an object snapshot in memory and has no revision key.

**DERIVED FACT.** A revision-aware UI must choose whether a view is pinned to a revision or follows the aggregate’s current revision. That choice cannot be inferred from the current numeric Task Pack ID alone.

## 6. MCP, export, backup, and external boundaries

### 6.1 MCP

**CURRENT FACT.** `server/src/mcp/registerTools.ts`, `registerResources.ts`, and `mcpServices.ts` expose:

- `contextforge_list_task_packs` — bounded flat summaries without full prompts;
- `contextforge_get_task_pack` — one flat Task Pack by numeric `taskPackId`, with prompt/diagnostic inclusion controls and truncation metadata;
- `contextforge_explain_task_pack` — recipe-derived explanation, with truthful unavailable warnings for older packs;
- `contextforge_create_task_pack` — the same guarded pipeline, requiring both global permission and `confirmCreate: true`;
- resources at `contextforge://projects/{projectId}/task-packs` and `contextforge://task-packs/{taskPackId}`.

MCP sanitizes stored values, redacts credential-shaped fields, limits text, rejects unknown Task Pack IDs, and never edits repositories. It has no draft, revision, lifecycle, comparison, or output-review contract.

**Compatibility requirement.** Existing clients must continue to resolve `taskPackId` and the current resource URI without supplying a revision. Revision-aware reads must be additive and explicit.

### 6.2 `.md` and `.txt` export

`apps/desktop/renderer/src/utils/taskPackExport.ts` exports the current flat Task Pack. It includes task/prompt, project display name, target/task type, generation mode/model, created/exported dates, clarifications, and recipe counts. It does not include local Task Pack ID, revision identity/number, lifecycle/review status, `updatedAt`, selected-context proof, or full diagnostics.

`buildExportSafeProjectMetadata()` in `server/src/taskPacks/taskPackPrivacy.ts` substitutes `<local-project>` for the real root in generated agent-ready content. Export must retain that privacy boundary. A future revision comparison must not store raw source code merely to reconstruct differences.

### 6.3 Workspace backup and restore

**CURRENT FACT.** `server/src/storage/workspaceBackup.ts` emits `contextforge.workspace.backup`, `formatVersion: 1`. `data.taskPacks` is the flat output of `storage.listTaskPacks()`, including recipe JSON. Project source files and secret settings are excluded; local project records (including local paths) are intentionally included in this local backup.

**CURRENT FACT.** Restore/import is explicitly not implemented. `server/src/storage/storageAudit.ts` reports it as a guarded future flow. `server/src/storage/json.ts` is only a generic JSON value helper, not an alternate Task Pack store.

**Compatibility requirement.** A lifecycle migration cannot rely on restore to recover from a destructive rewrite. It needs an additive database migration, a pre-migration backup, and a v1-backup reader when restore is eventually implemented.

### 6.4 Desktop Sync/cloud handoff

Desktop Sync publishes a flat task/prompt payload with `sourceTaskPackId`, `sourceCreatedAt`, and a content hash. It omits generation recipe/diagnostics, project ID, lifecycle, and revision identity. Import validates integrity and creates a local row with `generationRecipe: null`.

**DERIVED FACT.** Numeric `taskPackId` alone cannot safely merge a returned cloud object into a local aggregate. Future sync metadata must pair the origin installation identity with stable Task Pack and revision identity; old payloads must continue to import as a new aggregate with one legacy/imported revision.

## 7. Compatibility risks

1. **Historical evidence overwrite.** Converting `PATCH /:id/content` to another in-place write would keep the current inconsistency between edited content and original diagnostics.
2. **Identity ambiguity.** Treating every revision as a new Task Pack would break stable MCP/resource links, dashboard grouping, freshness maps, search results, GitHub links, and external `sourceTaskPackId` assumptions.
3. **Flat DTO breakage.** Removing top-level `rawTask`, `generatedPrompt`, or generation fields would break current renderer and MCP consumers.
4. **Timestamp ambiguity.** Reusing `updatedAt` as generated/reviewed/completed/archived time would make existing records and ordering misleading.
5. **Recipe mutation.** `githubCreatedIssue` is workflow metadata mixed into generation evidence. Copying only the latest recipe into history could rewrite generation provenance; freezing every recipe mutation as if it were generated content would create noisy revisions. These concerns must be separated.
6. **Freshness drift.** Current freshness is aggregate-ID + row-`createdAt` based. Revisions need their own creation/basis identity; otherwise a new revision may inherit a stale status or an old revision may appear current.
7. **Legacy null recipes.** Imported and old packs can have no recipe. Migration must not fabricate selector evidence or generation diagnostics.
8. **Adapter divergence.** SQLite has numbered migrations; PostgreSQL has idempotent `ensureSchema()` DDL. A one-adapter implementation is not acceptable.
9. **Backup downgrade.** A v1 backup cannot represent multiple revisions or transition history. Flattening without an explicit policy silently loses history.
10. **Concurrent edits.** Two renderer/MCP/API clients can currently overwrite the same row. Revision creation without `expectedRevisionId` could create surprising branches or incorrectly advance `currentRevisionId`.
11. **Project deletion cascade.** Revisions and future output reviews must follow the aggregate’s project ownership and deletion policy; orphaning historical evidence would violate current expectations.
12. **Search/navigation snapshots.** Existing navigation stores full Task Pack objects and compares only aggregate IDs. A background update could make a pinned historical view silently show current data.
13. **Privacy amplification.** Persisting diff/source snapshots for comparison would expand sensitive storage. Version comparison should operate on Task Pack revision payloads and safe grounded metadata, not arbitrary repository contents.
14. **Lifecycle inference.** `createdAt`, `updatedAt`, GitHub issue creation, export, or publish does not prove review, completion, or acceptance.

## 8. Architecture alternatives

### Option A — mutable `TaskPack` row plus separate revision history

The current row remains authoritative/current; a history table receives snapshots before mutations.

| Dimension | Evaluation |
|---|---|
| Backward compatibility | High initially: current reads remain unchanged. |
| Migration complexity | Low to medium: add history table and snapshot legacy row. |
| Renderer/API complexity | Medium: current row plus history endpoints. |
| SQLite/PostgreSQL parity | Straightforward mechanically. |
| MCP/export/backup | Existing reads naturally return mutable current row. |
| Comparison | Adequate if every mutation is intercepted. |
| Historical diagnostics | Fragile: missed write paths or internal recipe updates can desynchronize current/history. |
| Output review | Must pin a history snapshot that is not the authoritative entity; semantics are awkward. |
| Privacy | No inherent improvement. |

**Assessment.** Rejected. It preserves two authorities—the mutable row and its history—and relies on every future mutation path correctly snapshotting before overwrite. The existing content and recipe write paths already demonstrate why that is error-prone.

### Option B — immutable `TaskPackRevision` rows plus stable `TaskPack` aggregate identity

The aggregate owns project/lifecycle/current pointers. Every content/generation snapshot is immutable and addressable. The existing flat Task Pack DTO becomes a projection of aggregate + current revision.

| Dimension | Evaluation |
|---|---|
| Backward compatibility | High with a flat current-revision projection and compatibility columns during migration. Existing numeric `taskPackId` remains stable. |
| Migration complexity | Medium: additive tables/columns, one revision backfill per legacy row, dual-read/dual-write transition. |
| Renderer/API complexity | Medium but explicit: default current projection plus opt-in history/compare/draft endpoints. |
| SQLite/PostgreSQL parity | Good with the same logical keys, constraints, and transaction invariants implemented by both adapters. |
| MCP compatibility | Strong: old tools keep `taskPackId`; optional revision reads are additive. |
| Export/backup | Strong: exports can identify a revision; backup can serialize aggregate/revisions/events without duplicating stable identity. |
| Comparison | Strong: two immutable snapshots can be compared deterministically. |
| Historical diagnostics | Strong: diagnostics are frozen with the revision that they describe. |
| Future output review | Strong: review links to an exact revision, never a moving “current” row. |
| Privacy | Strongest option because comparisons can use already-stored revision payloads and safe context metadata. |

**Assessment.** Recommended.

### Option C — every revision is a `TaskPack`, linked by parent/root identity

Each edit/generation inserts another `task_packs` row with `root_task_pack_id`/`parent_task_pack_id`.

| Dimension | Evaluation |
|---|---|
| Backward compatibility | Superficially high at the row level, but existing list/search/MCP calls would expose duplicates unless all readers learn grouping. |
| Migration complexity | Medium: add lineage fields and mark roots. |
| Renderer/API complexity | High: every query must distinguish aggregate root, leaf/current, and revision row. |
| SQLite/PostgreSQL parity | Mechanically possible, semantically cumbersome. |
| MCP/export/backup | Existing `taskPackId` changes meaning between stable aggregate and revision; old clients cannot reliably follow “current”. |
| Comparison | Good after lineage validation, but branching and current selection need extra rules. |
| Historical diagnostics | Good per row. |
| Future output review | Exact revision links are possible, but stable workflow identity is indirect. |
| Privacy | Neutral. Data duplication is higher. |

**Assessment.** Rejected. It overloads the existing Task Pack identity with both workflow and revision semantics and makes the common list/get path harder to keep compatible.

## 9. Recommended lifecycle/version contract

### 9.1 Aggregate

**PROPOSAL.** Preserve the existing numeric `TaskPack.id` as the stable local aggregate ID. The aggregate owns:

```text
TaskPackAggregate
  id
  projectId
  title
  lifecycleState          # active | completed | archived
  currentRevisionId
  acceptedRevisionId?     # nullable explicit pointer
  lifecycleVersion        # optimistic-concurrency integer
  createdAt
  updatedAt               # aggregate metadata/pointer/lifecycle mutation only
  completedAt?
  archivedAt?
```

`title` may remain aggregate metadata so a user can rename the workflow without rewriting revision evidence. Title history, if required later, belongs in lifecycle/metadata events; it must not be inferred from revised raw task text.

### 9.2 Immutable revision

**PROPOSAL.** Add an immutable revision entity:

```text
TaskPackRevision
  id
  taskPackId
  revisionNumber          # unique with taskPackId, monotonically increasing
  baseRevisionId?         # explicit ancestry; null for first/imported legacy snapshot
  sourceKind              # generated | manual_edit | regenerated | imported | split | legacy_snapshot
  rawTask
  taskType
  targetTool
  generatedPrompt
  generationMode
  generationModel?
  generationMessage?
  generationUsedFallback
  generationDurationMs?
  generationRecipe?
  groundedContextSnapshot?
  freshnessBasis?
  contentHash
  createdAt
```

The payload is immutable after insertion. No adapter `updateTaskPackRevision()` should exist. Database constraints and storage smoke tests must reject update/delete outside an explicit aggregate deletion/migration path.

`groundedContextSnapshot` is privacy-bounded metadata: normalized repository-relative selected paths, usages/roles, evidence/proof classes already authorized for persistence, selector/engine identity, and repository observation/snapshot identifiers if already available at the generation boundary. It must not add raw source, prompts, snippets, secrets, or absolute paths merely for comparison.

`freshnessBasis` should preserve the available awareness observation timestamps/identity and safe project snapshot identity at revision creation. For legacy rows where it cannot be proven, it remains null; the UI reports unknown/legacy-limited rather than fabricating evidence.

`contentHash` is a deterministic SHA-256 of a versioned canonical JSON payload containing the immutable revision fields, excluding database IDs and timestamps. It is an integrity/comparison aid, not authorization evidence.

### 9.3 Persisted draft

**PROPOSAL.** A draft is not a revision and is not automatically a Task Pack:

```text
TaskPackDraftRecord
  id                       # opaque stable draft ID
  projectId
  taskPackId?              # set when revising an existing aggregate
  baseRevisionId?          # exact revision being edited
  content                  # current TaskPackDraft fields
  createdAt
  updatedAt
  expiresAt?               # policy only if explicitly approved later
  status                   # active | materialized | discarded
```

Draft mutation is allowed and uses optimistic concurrency. Materializing a draft atomically creates a revision and marks the draft materialized. Drafts are local/private, excluded from MCP list/get by default, and not implicitly published/exported. Existing unsaved renderer drafts remain compatible: persistence begins only after an explicit save/autosave policy is separately approved.

### 9.4 Transition/event record

**PROPOSAL.** Store workflow changes as append-only `TaskPackEvent` records with safe actor/source metadata:

```text
id, taskPackId, revisionId?, eventType, fromState?, toState?, createdAt, metadata?
```

Events cover lifecycle and review transitions, not raw source content. Aggregate state/pointers are a transactionally maintained projection for efficient listing.

### 9.5 Bounded work splitting

**PROPOSAL.** Future splits create independent child Task Pack aggregates, each with its own lifecycle and revisions. A relation table links the exact source revision to children:

```text
TaskPackRelation
  rootTaskPackId
  sourceRevisionId
  childTaskPackId
  relationType = split_child
  boundedArea             # frontend | backend | tests | docs | review, validated vocabulary
  ordinal
```

The relation must not grant edit authority. Every child generation runs the existing guarded selection/authorization pipeline for its bounded task. No project-specific split logic belongs in the contract.

### 9.6 Output/diff review linkage

**PROPOSAL.** A later output-review entity must reference both `taskPackId` and the exact `taskPackRevisionId`. It may record repository snapshot/HEAD identity, changed repository-relative paths, line-count metadata, scope/secret/generated-file findings, acceptance-criteria results, and review disposition. It must not default to storing raw diff/source content. Linking only to the aggregate is invalid because “current revision” can change after review.

## 10. Lifecycle transition model

A single lifecycle enum is insufficient. Use three explicit state machines.

### 10.1 Draft state

```text
active ──materialize──> materialized
active ──discard──────> discarded
```

- Only `active` drafts are editable.
- `materialized` and `discarded` drafts are terminal audit states or may be pruned by an explicit retention policy.
- Materialization creates a new immutable revision in the same transaction.
- A stale `baseRevisionId` causes a conflict/review response; it never silently overwrites current.

### 10.2 Revision review state (event-derived)

```text
unreviewed ──start review────> in_review
unreviewed ──accept──────────> accepted
in_review  ──accept──────────> accepted
in_review  ──request changes─> changes_requested
changes_requested ──new revision──> new revision starts unreviewed
```

The revision payload never changes. Review disposition is derived from append-only events. An accepted historical revision remains accepted even when a later revision becomes current; `acceptedRevisionId` explicitly says which accepted revision the aggregate currently recognizes.

Illegal transitions include accepting a nonexistent revision, reviewing a revision from another aggregate, changing an accepted event in place, or marking a draft as accepted.

### 10.3 Aggregate lifecycle

```text
active ──complete explicitly──> completed
completed ──reopen explicitly─> active
active/completed ──archive────> archived
archived ──unarchive──────────> prior non-archived state
```

- Completion requires an explicit action and, under the recommended policy, an accepted current revision. It is not inferred from export, copy, GitHub issue creation, elapsed time, or `updatedAt`.
- Creating a revision for a completed Task Pack requires an explicit reopen or a transaction that records `reopened` before revision creation.
- Archive is reversible and hides by default only in new UI queries; stable ID reads remain possible according to authorization.
- Archive does not delete revisions, diagnostics, events, or output reviews.
- No lifecycle transition weakens Task Pack generation/selection authorization.

### 10.4 Required timestamps

Required timestamps are event timestamps plus aggregate `createdAt`, `updatedAt`, `completedAt`, and `archivedAt`; revision `createdAt`; and draft `createdAt`/`updatedAt`. `generatedAt` is only present when `sourceKind` is generated/regenerated. Imported and manual-edit revisions must not be assigned a fabricated generation time.

### 10.5 Legacy interpretation

Every legacy row becomes:

- one aggregate with the same `id`, project, title, and `lifecycleState = active`;
- one immutable revision with `revisionNumber = 1`, content copied exactly, and `sourceKind = imported` only when the existing cloud marker proves import, otherwise `legacy_snapshot` (add this migration-only source kind if needed);
- `currentRevisionId` pointing to revision 1;
- no accepted revision and no review/completion/archive events;
- nullable grounded/freshness basis when unavailable.

Migration must not infer “accepted”, “completed”, or “archived” from age, recipe presence, GitHub linkage, or page terminology.

## 11. Versioning invariants

1. A stable Task Pack aggregate ID never identifies a different project or workflow.
2. `(taskPackId, revisionNumber)` is unique and monotonically allocated inside one transaction.
3. A revision’s content, generation metadata, recipe, selector/generation/performance diagnostics, grounded context metadata, target tool, project association through the aggregate, timestamps, and content hash never change after insert.
4. A later edit creates a revision; it never rewrites historical `rawTask`, `generatedPrompt`, generation recipe, or diagnostics.
5. Manual edits are honestly labeled `manual_edit`; they do not pretend that old generation diagnostics describe the new text. Unchanged provenance may be referenced as `baseRevisionId`, not copied as newly generated evidence without a clear inherited marker.
6. Regeneration runs the existing guarded pipeline and stores the resulting diagnostics on the new revision.
7. Supporting/reference paths remain non-editable unless the existing authorization pipeline proves an edit role. Versioning does not expand authority.
8. Legacy null/missing metadata remains null/unavailable. Migration never fabricates grounding, freshness, or model evidence.
9. Freshness is computed per revision using that revision’s `createdAt`, selected paths, and available freshness basis; aggregate list freshness is the current revision’s projection.
10. Comparisons are deterministic over two immutable revisions and report unavailable fields explicitly.
11. Comparison never requires re-reading repository source. It compares Task Pack payloads and stored privacy-safe context metadata. A separate future output review may observe the repository under its own explicit authority.
12. Lifecycle state and review disposition are explicit events, never inferred from timestamps alone.
13. `currentRevisionId`, `acceptedRevisionId`, lifecycle projection, and emitted events update atomically.
14. Revision creation uses `expectedCurrentRevisionId` or equivalent optimistic concurrency. A mismatch returns conflict; it never silently forks/overwrites unless a future explicit branch contract exists.
15. Existing safety, secret, prompt-injection, explicit-target, generation, and authorization gates remain authoritative.

## 12. Migration strategy

### 12.1 Logical migration

**PROPOSAL.** Reserve logical migration `0003_task_pack_lifecycle_revisions`, schema version `3`. Its SQLite and PostgreSQL implementations must create equivalent contracts:

- `task_pack_revisions`;
- `task_pack_events`;
- `task_pack_drafts` (it may be delivered in a later migration if TP-LC-01 is intentionally split, but the contract must be reserved now);
- `task_pack_relations` only when bounded splitting is implemented;
- nullable aggregate columns on `task_packs`: `current_revision_id`, `accepted_revision_id`, `lifecycle_state`, `lifecycle_version`, `completed_at`, `archived_at`.

The first migration should not create output-review tables before that contract is audited.

### 12.2 Additive backfill

1. Require a successful workspace backup before desktop migration when packaged restore support exists; until then, surface a clear preflight and retain the database copy used by existing storage safeguards.
2. Create new tables/columns without dropping or rewriting legacy content columns.
3. Insert one revision per legacy Task Pack by copying values exactly.
4. Compute a versioned canonical content hash without normalizing user text beyond the documented JSON encoding.
5. Set current pointers and `active` lifecycle state.
6. Validate counts, unique `(task_pack_id, revision_number)`, pointer ownership, content hashes, and null-recipe preservation.
7. Record the migration only after validation succeeds.

SQLite must execute DDL, backfill, validation, and migration-record insertion inside an explicit transaction (`BEGIN IMMEDIATE`/`COMMIT`, with `ROLLBACK` on any error) before persisting the sql.js database file. PostgreSQL must use one transaction and equivalent constraints/indexes. The existing SQLite migration runner needs a narrowly reviewed transactional capability; PostgreSQL needs an explicit migration record or equivalent versioned runner rather than an untracked lifecycle `ALTER` sequence.

### 12.3 Compatibility projection and dual write

For at least one compatibility phase:

- reads build the flat `TaskPackRecord` from aggregate + current revision;
- new revision creation also refreshes legacy content columns as a **current projection only**;
- legacy columns are never treated as history;
- `PATCH /:id/content` creates a revision and returns the flat current projection;
- internal GitHub linkage becomes aggregate/workflow metadata or an event, not a mutation of frozen generation evidence;
- a verification job/tests ensure legacy projection equals current revision.

Keeping the columns makes code rollback possible without deleting revision data. After multiple revisions exist, rolling code back exposes only the latest compatibility projection but does not destroy revision rows. Dropping legacy columns is a later, separately approved migration after backup/restore and all external consumers are revision-aware.

### 12.4 Backup and JSON compatibility

- Continue reading `formatVersion: 1` as one aggregate + one legacy revision per Task Pack.
- Introduce backup format v2 additively with aggregates, revisions, events, and optionally active drafts under explicit privacy policy.
- For one transition window, v2 may include `data.taskPacks` as flat current projections for inspection/downgrade plus authoritative `taskPackAggregates`/`taskPackRevisions`; the format must label which is authoritative.
- Never flatten multiple revisions and claim it is a lossless v1 export.
- `.md`/`.txt` exports remain readable text and add optional stable aggregate/revision metadata without exposing local roots or diagnostics by default.
- Desktop Sync v1 payloads import as one aggregate/one imported revision. New optional origin aggregate/revision fields must be paired with `originInstallationId`; they must not be required from old senders.

### 12.5 Rollback

Rollback means disabling revision-aware code while leaving additive tables intact, not deleting history. Before any destructive down-migration, require a v2 backup and explicit operator confirmation. There should be no automatic downgrade that merges revisions into one row and discards evidence.

## 13. Proposed API evolution

### 13.1 Backwards-compatible current projection

**PROPOSAL.** Keep existing routes and fields:

- `GET /task-packs` returns current flat projections and may add `currentRevisionId`, `revisionNumber`, `lifecycleState`, and review summary.
- `POST /task-packs` atomically creates aggregate + revision 1 and returns the same flat shape plus revision metadata.
- `PATCH /task-packs/:id/content` remains temporarily supported but creates a `manual_edit` revision. It requires/accepts `expectedCurrentRevisionId`; old clients without it may be allowed only under an explicit compatibility policy with conflict detection based on `updatedAt`.
- `POST /task-packs/:id/github/issue` records workflow linkage without mutating revision generation evidence.

Add a direct `GET /task-packs/:id` current projection before revision-specific consumers are built.

### 13.2 Revision and comparison endpoints

Recommended additive endpoints:

```text
GET  /task-packs/:id/revisions
GET  /task-packs/:id/revisions/:revisionId
POST /task-packs/:id/revisions                 # guarded materialize/regenerate path
GET  /task-packs/:id/compare?from=...&to=...
```

Comparison output should expose changed Task Pack fields, rules/criteria, generation provenance summaries, selected path/usage/evidence deltas, and prompt/task text diffs. It should not return newly read repository content.

### 13.3 Draft and transition endpoints

```text
POST   /task-pack-drafts
GET    /task-pack-drafts/:draftId
PATCH  /task-pack-drafts/:draftId              # expectedUpdatedAt/version required
POST   /task-pack-drafts/:draftId/materialize
DELETE /task-pack-drafts/:draftId               # explicit discard semantics

POST /task-packs/:id/transitions                # typed, validated action
POST /task-packs/:id/revisions/:revisionId/review-events
```

Use action schemas and legal-transition validation rather than accepting arbitrary destination state strings.

### 13.4 MCP compatibility

- Keep `contextforge_list_task_packs`, `contextforge_get_task_pack`, `contextforge_explain_task_pack`, and `contextforge://task-packs/{taskPackId}` operating on the current revision when no revision is supplied.
- Add optional `revisionId` only after server/API revision reads are stable, or add separate read-only tools/resources for history/compare.
- Do not expose drafts by default.
- Preserve prompt truncation, diagnostic controls, redaction, safe envelopes, and unavailable warnings.
- Preserve global creation permission + per-call `confirmCreate: true`; versioning is not a new authorization channel.
- Any future lifecycle write tool requires a separate permission/confirmation review and is not implied by create permission.

## 14. Proposed renderer evolution

### Task Packs list

Show one row/card per aggregate, using current revision data. Add compact current revision/review/lifecycle indicators and filters. Archived packs move behind an explicit filter; they do not disappear from stable links. Do not show every revision as a separate Task Pack.

### Task Pack Result

Pin the view to an explicit `revisionId`. Show “current” when appropriate, a progressively disclosed history selector, and an action to compare two revisions. Editing creates a draft based on the viewed revision; saving creates a new revision after conflict checks. Diagnostics always come from the viewed revision.

### Builder

Support explicit “Save draft”, restore, discard, and materialize actions. Display base revision when revising a pack. Continue to run Task Understanding/context review and the existing guarded generation path. Do not imply that saving a draft grants generation or edit authorization.

### Version history and comparison

The history panel should show revision number, source kind, creation time, author/source category, review status, and generation mode—without dumping diagnostics by default. Comparison should lead with task/prompt and selected-context deltas; advanced recipe/diagnostic changes remain progressively disclosed.

### Lifecycle controls

Expose only valid next actions. Complete/archive/reopen must be explicit and confirmed where data may become hidden. Review controls belong to the selected revision; lifecycle controls belong to the aggregate.

### Quick Peek and Persistent Inspector

Default to the aggregate’s current revision but display the revision number. When invoked from a pinned historical result/compare view, preserve that revision ID. Inspector may show lifecycle/review provenance; it must not silently jump to current.

### Dashboard recent Task Packs

Continue to show aggregates, ordered by an explicitly chosen product timestamp (for example aggregate activity or current revision creation), not the ambiguous legacy `createdAt`. Show current revision freshness. Archived packs should be omitted from the default recent set only after archive is real data.

## 15. Validation strategy

### Contract and domain tests

- exhaustive legal/illegal draft, review, and aggregate transitions;
- immutable revision payload and monotonic numbering;
- optimistic-concurrency conflict behavior;
- current/accepted pointer ownership and event projection consistency;
- deterministic comparison ordering and unavailable-field handling;
- child split relations do not confer authorization.

### Persistence and migration tests

- SQLite migration from representative schema-v2 databases, including null/old/malformed-but-readable recipe JSON;
- rollback on injected failure leaves schema/data unchanged and migration unrecorded;
- PostgreSQL parity for columns, constraints, indexes, transactions, and projections;
- exact legacy content/timestamp preservation and one-revision-per-row counts;
- project cascade behavior is explicit and identical across adapters;
- compatibility columns always equal current revision during the transition;
- no revision update/delete adapter surface.

### API and renderer tests

- existing flat list/create/update clients continue to work;
- content update creates a revision and never overwrites prior evidence;
- history/get/compare are scoped to the aggregate and project;
- editor conflicts do not falsely show saved state;
- draft restart restoration and discard/materialize behavior;
- list/result/Quick Peek/Inspector/navigation stay pinned to the intended revision;
- progressive disclosure and keyboard/accessibility coverage.

### MCP, export, sync, and backup tests

- old MCP calls work with only `taskPackId` and resolve current revision;
- explicit revision reads cannot cross aggregate identity;
- create still requires both permissions and confirmation;
- v1 backup import maps each Task Pack to one revision without invented metadata;
- v2 round-trip preserves all revisions/events and privacy exclusions;
- text export contains no absolute project root and identifies revision additively;
- Desktop Sync v1 import remains valid; v2 origin identity cannot collide across installations;
- diagnostics/source content/secrets are not added to list operations or transition metadata.

### Safety and non-regression gates

- current Task Pack generation/reliability, selector, authorization-authority, safety-preconditions, explicit-create, and repository-hygiene suites;
- SQLite and PostgreSQL adapter contract suites;
- renderer and server builds;
- MCP smoke suite;
- backup/export privacy smoke;
- Context Engine v2 suites only as regression evidence—no CE2 source or semantics change is part of lifecycle work.

## 16. Recommended implementation sequence

### TP-LC-01 — Freeze shared lifecycle and revision contracts

Define shared typed aggregate/revision/draft/event DTOs, canonical revision hashing, lifecycle transition rules, and adapter interfaces. Add domain tests only; no UI and no change to existing route behavior.

**Gate:** type/build, transition matrix, hash determinism, no CE2 diff.

### TP-LC-02 — Additive storage migration and adapter parity

Implement logical migration `0003_task_pack_lifecycle_revisions`, transactional legacy backfill, SQLite/PostgreSQL parity, immutable revision persistence, pointer constraints, and current flat projection.

**Gate:** migration/rollback fixtures, row-to-revision equivalence, adapter parity, backup preflight, existing storage audits.

### TP-LC-03 — Revision-safe Task Pack service and API compatibility

Move `POST /task-packs`, `PATCH /:id/content`, performance diagnostic attachment, and GitHub linkage behind a Task Pack application service. Make content edits create revisions; keep existing flat responses. Add direct current/history/revision reads and concurrency checks.

**Gate:** existing API tests plus history/immutability/conflict tests; all selector/generation/authorization suites unchanged.

### TP-LC-04 — Persisted draft contract

Add explicit draft save/restore/discard/materialize APIs and renderer controller integration. Keep transient drafts compatible and do not expose drafts through MCP.

**Gate:** restart restoration, conflict, materialization atomicity, privacy, failure-state UI tests.

### TP-LC-05 — Lifecycle and review events

Implement aggregate lifecycle transitions and revision review events, including accepted/current pointers and archive filters. Do not infer state from timestamps.

**Gate:** exhaustive state-machine tests, event/projection transaction tests, legacy rows remain active/unreviewed.

### TP-LC-06 — Version history and comparison UI

Add pinned revision routing, history, deterministic comparison, and progressively disclosed Result/List/Builder/Quick Peek/Inspector/Dashboard updates.

**Gate:** renderer build, navigation restoration, accessibility, current-vs-historical diagnostics, zoom/density/manual matrix.

### TP-LC-07 — External boundary compatibility

Version workspace backup, preserve v1 reading, add revision metadata to text export, extend Desktop Sync identity additively, and add optional revision-aware MCP reads while preserving stable `taskPackId` defaults and write guards.

**Gate:** v1/v2 backup fixtures, export privacy, Desktop Sync integrity, MCP smoke/backward compatibility, no absolute paths/secrets.

### TP-LC-08 — Bounded work splitting contract

Create child aggregates and revision-pinned split relations for frontend/backend/tests/docs/review work. Every child uses existing grounding and authorization; no automatic execution.

**Gate:** bounded relation/domain tests, authorization non-expansion, deterministic ordering, no project-specific rules.

### TP-LC-09 — Output/diff review linkage audit and foundation

Audit Diff Review Lite against the frozen revision contract, then add a revision-pinned, privacy-safe output-review record in a separate work order. Do not persist raw source/diff content by default.

**Gate:** exact revision linkage, scope/secret/generated-file safety, repository snapshot identity, privacy serialization, no lifecycle inference.

---

The bounded order is intentional: stable contracts and migration precede UI; immutable revision creation precedes lifecycle controls; external formats change only after the local data model is proven; splitting and output review build on exact revision identity rather than retrofitting it later.
