import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "sql.js";
import { pool } from "../db/pool.js";
import { SqliteStorageAdapter } from "./SqliteStorageAdapter.js";
import { PostgresStorageAdapter } from "./PostgresStorageAdapter.js";
import { parseWorkspaceBackup } from "./workspaceBackupReader.js";
import type { TaskPackRevisionContent, TaskPackReviewState } from "../taskPacks/taskPackLifecycle.js";
import type { WorkspaceBackupStorageSnapshot } from "./types.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-backup-snapshot-"));
const adapter = new SqliteStorageAdapter(path.join(root, "snapshot.sqlite"));
const scenarios: { name: string; run: () => void | Promise<void> }[] = [];
const scenario = (name: string, run: () => void | Promise<void>) => scenarios.push({ name, run });
let db: Database, projectId: number, first: number, completed: number, archived: number, serial = 0;
const content: TaskPackRevisionContent = { sourceKind: "generated", rawTask: "  Задача\r\n\tExact  ", taskType: "tests",
  targetTool: "generic", generatedPrompt: "# Exact\r\n\tDocument  ", generationMode: "template", generationModel: null,
  generationMessage: "Historical message", generationUsedFallback: false, generationDurationMs: 1.25,
  generationRecipe: { githubIssue: { number: 12, htmlUrl: "https://example.invalid/source" },
    githubCreatedIssue: { number: 13, htmlUrl: "https://example.invalid/historical" } },
  diagnostics: { selector: { authored: "exact" }, generation: null, performance: { durationMs: 1.25 } },
  groundedContextSnapshot: null, freshnessBasis: null };
const time = () => new Date(Date.UTC(2030, 0, 1) + ++serial * 1000).toISOString();
const snapshot = () => adapter.getWorkspaceBackupSnapshot();
function rows(table: string): Record<string, unknown>[] {
  const stmt = db.prepare(`SELECT * FROM ${table}`);
  try { const result = []; while (stmt.step()) result.push(stmt.getAsObject()); return result; }
  finally { stmt.free(); }
}
async function create(title: string) {
  return (await adapter.createTaskPackWithInitialRevision({ projectId, title, generatedAt: time(),
    revisionContent: content, compatibilityGenerationRecipe: { flatOnly: "Not authoritative" } })).id;
}
async function review(taskPackId: number, action: "start_review" | "accept", expectedReviewState: TaskPackReviewState) {
  const aggregate = (await adapter.getTaskPackAggregate(taskPackId))!;
  return adapter.transitionTaskPackRevisionReview({ taskPackId, revisionId: aggregate.currentRevisionId,
    expectedLifecycleVersion: aggregate.lifecycleVersion, expectedReviewState, transition: { type: action },
    eventId: `review-${++serial}`, source: "user", actorId: "synthetic actor", metadata: { authored: "exact" }, createdAt: time() });
}
async function lifecycle(taskPackId: number, type: "complete" | "archive") {
  const aggregate = (await adapter.getTaskPackAggregate(taskPackId))!;
  return adapter.transitionTaskPackAggregateLifecycle({ taskPackId, expectedLifecycleVersion: aggregate.lifecycleVersion,
    transition: { type }, eventId: `lifecycle-${++serial}`, source: "user", actorId: null, metadata: { authored: "exact" }, createdAt: time() });
}
function validate(value: WorkspaceBackupStorageSnapshot) {
  const fixture = JSON.parse(fs.readFileSync(new URL("fixtures/workspaceBackup.v2.json", import.meta.url), "utf8"));
  fixture.data = { ...value, rulesAndTemplates: null, safeSettings: fixture.data.safeSettings };
  fixture.counts = { projects: value.projects.length, taskPacks: value.taskPackAggregates.length,
    projectMemories: value.projectMemory.reduce((sum, group) => sum + group.memories.length, 0), ruleTemplates: 0, settings: 9,
    revisions: value.taskPackRevisions.length, lifecycleEvents: value.taskPackLifecycleEvents.length, reviewEvents: value.taskPackReviewEvents.length };
  assert.equal(parseWorkspaceBackup(JSON.stringify(fixture)).formatVersion, 2);
}
scenario("empty lifecycle-aware workspace returns exactly six relational sections", async () => {
  assert.deepEqual(await snapshot(), { projects: [], projectMemory: [], taskPackAggregates: [], taskPackRevisions: [],
    taskPackLifecycleEvents: [], taskPackReviewEvents: [] }); validate(await snapshot());
});
scenario("projects and memory share the same snapshot with empty project groups retained", async () => {
  const project = { name: "Synthetic snapshot", localPath: path.join(root, "project"), packageManager: null,
    detectedStack: [], scripts: {}, readinessScore: 0, readinessReport: { score: 0, checks: [], issues: [] } };
  projectId = (await adapter.upsertScannedProject(project)).id;
  const other = await adapter.upsertScannedProject({ ...project, localPath: path.join(root, "other") });
  await adapter.createProjectMemory({ projectId, title: "Synthetic memory", content: "  Exact\r\n\tMemory  ", category: "custom" });
  const value = await snapshot(); assert.deepEqual(value.projects.map(p => p.id), [projectId, other.id]);
  assert.equal(value.projectMemory[0].memories[0].content, "  Exact\r\n\tMemory  ");
  assert.deepEqual(value.projectMemory[1], { projectId: other.id, memories: [] }); validate(value);
});
scenario("one aggregate/one revision uses authoritative fields, original hash and exact content", async () => {
  first = await create("First"); const value = await snapshot();
  assert.equal(value.taskPackAggregates.length, 1); assert.equal(value.taskPackRevisions.length, 1);
  assert.equal(value.taskPackRevisions[0].rawTask, content.rawTask); assert.deepEqual(value.taskPackRevisions[0].generationRecipe, content.generationRecipe);
  assert.equal(value.taskPackRevisions[0].contentHash, (await adapter.getCurrentTaskPackRevision(first))!.contentHash);
  assert.equal("taskPacks" in value, false); assert.equal("rulesAndTemplates" in value, false); validate(value);
});
scenario("many aggregates/revisions include accepted historical revision independently of current", async () => {
  await review(first, "start_review", "unreviewed"); await review(first, "accept", "in_review");
  const initial = (await adapter.getCurrentTaskPackRevision(first))!;
  const next = await adapter.appendTaskPackRevision({ ...content, sourceKind: "manual_edit", taskPackId: first,
    baseRevisionId: initial.id, rawTask: "  Edited\r\n\tTask  ", createdAt: time(), generatedAt: null });
  completed = await create("Completed"); archived = await create("Archived");
  const value = await snapshot(); assert.equal(value.taskPackAggregates.length, 3); assert.equal(value.taskPackRevisions.length, 4);
  assert.equal(value.taskPackAggregates[0].acceptedRevisionId, initial.id); assert.equal(value.taskPackAggregates[0].currentRevisionId, next.id);
  assert.deepEqual(value.taskPackReviewEvents.map(e => e.toState), ["in_review", "accepted"]); validate(value);
});
scenario("completed/archived projections and complete lifecycle/review event arrays preserved", async () => {
  await review(completed, "accept", "unreviewed"); await lifecycle(completed, "complete"); await lifecycle(archived, "archive");
  const value = await snapshot(); assert.deepEqual(value.taskPackAggregates.map(a => a.lifecycle.state), ["active", "completed", "archived"]);
  assert.equal(value.taskPackLifecycleEvents.length, 2); assert.equal(value.taskPackReviewEvents.length, 3); validate(value);
});
scenario("snapshot excludes drafts, standalone integration links/settings/schema/flat overlays", async () => {
  await adapter.createTaskPackDraft({ id: "synthetic-draft", projectId, taskPackId: null, baseRevisionId: null, expiresAt: null,
    content: { rawTask: "Draft only", taskType: "tests", targetTool: "generic", templateId: null, ruleProfileId: null,
      enabledRuleIds: [], customRulesText: null, acceptanceCriteriaPresetId: null, acceptanceCriteriaText: null,
      clarifications: [], performanceSessionId: null, understandingSnapshotId: null, reviewedUnderstandingSnapshotId: null } });
  await adapter.createTaskPackGitHubCreatedIssueLink({ taskPackId: first, owner: "synthetic", repo: "repo", fullName: "synthetic/repo",
    issueNumber: 99, issueTitle: "Standalone only", issueUrl: "https://example.invalid/standalone", issueState: "open",
    labels: [], repositoryUrl: "https://example.invalid/standalone-repository", createdAt: time() });
  const value = await snapshot(); assert.doesNotMatch(JSON.stringify(value), /Draft only|Standalone only|flatOnly|standalone-repository/u);
  assert.equal(Object.keys(value).length, 6); validate(value);
});
scenario("SQLite uses six ordered reads inside owned BEGIN/COMMIT and never persists", async () => {
  const before = fs.readFileSync(path.join(root, "snapshot.sqlite"));
  const prepared: string[] = [], transactions: string[] = [];
  const originalPrepare = db.prepare, originalRun = db.run;
  const internals = adapter as unknown as { persist: () => void }; const persist = internals.persist;
  internals.persist = () => { throw new Error("Snapshot must not persist"); };
  db.prepare = ((sql: string, ...args: unknown[]) => { prepared.push(sql); return originalPrepare.call(db, sql, ...args as []); }) as typeof db.prepare;
  db.run = ((sql: string, ...args: unknown[]) => {
    if (sql === "COMMIT;") assert.equal(prepared.length, 6);
    transactions.push(sql); return originalRun.call(db, sql, ...args as []);
  }) as typeof db.run;
  try { await snapshot(); } finally { db.prepare = originalPrepare; db.run = originalRun; internals.persist = persist; }
  assert.equal(prepared.length, 6); assert.deepEqual(transactions, ["BEGIN DEFERRED;", "COMMIT;"]);
  assert.ok(prepared.every(sql => /^SELECT.*ORDER BY/isu.test(sql)));
  assert.deepEqual(fs.readFileSync(path.join(root, "snapshot.sqlite")), before);
});
scenario("SQLite query count stays six as Task Pack count grows", async () => {
  for (let i = 0; i < 12; i++) await create(`Many ${i}`);
  let calls = 0; const original = db.prepare;
  db.prepare = ((...args: Parameters<Database["prepare"]>) => { calls++; return original.apply(db, args); }) as typeof db.prepare;
  try { assert.equal((await snapshot()).taskPackAggregates.length, 15); assert.equal(calls, 6); }
  finally { db.prepare = original; }
});
scenario("SQLite native event tie ordering is retained, not re-sorted by JavaScript", async () => {
  const pack = await create("Event ties"), aggregate = (await adapter.getTaskPackAggregate(pack))!;
  const createdAt = "2040-01-01T00:00:00.000Z";
  await adapter.transitionTaskPackRevisionReview({ taskPackId: pack, revisionId: aggregate.currentRevisionId,
    expectedLifecycleVersion: aggregate.lifecycleVersion, expectedReviewState: "unreviewed", transition: { type: "start_review" },
    eventId: "tie-01", source: "user", actorId: null, metadata: null, createdAt });
  await adapter.transitionTaskPackRevisionReview({ taskPackId: pack, revisionId: aggregate.currentRevisionId,
    expectedLifecycleVersion: aggregate.lifecycleVersion, expectedReviewState: "in_review", transition: { type: "accept" },
    eventId: "tie-02", source: "user", actorId: null, metadata: null, createdAt });
  const value = await snapshot(); assert.deepEqual(value.taskPackReviewEvents.filter(event => event.taskPackId === pack).map(event => event.id),
    ["tie-01", "tie-02"]); validate(value);
});
scenario("SQLite preserves deterministic source ordering including event ties", async () => {
  const value = await snapshot(); assert.deepEqual(await snapshot(), value);
  assert.deepEqual(value.taskPackAggregates.map(a => a.id), [...value.taskPackAggregates.map(a => a.id)].sort((a,b) => a-b));
  assert.deepEqual(value.taskPackRevisions.map(r => [r.taskPackId,r.revisionNumber,r.id]),
    [...value.taskPackRevisions].sort((a,b) => a.taskPackId-b.taskPackId || a.revisionNumber-b.revisionNumber || a.id-b.id)
      .map(r => [r.taskPackId,r.revisionNumber,r.id]));
  const eventRows = db.exec("SELECT id FROM task_pack_revision_review_events ORDER BY task_pack_id ASC, revision_id ASC, created_at ASC, id ASC;");
  assert.deepEqual(value.taskPackReviewEvents.map(e => e.id), eventRows[0].values.map(r => r[0])); validate(value);
});
scenario("SQLite queued concurrent append cannot interleave after BEGIN; returned graph is the old coherent moment", async () => {
  const baseRevision = (await adapter.getCurrentTaskPackRevision(first))!;
  const original = db.prepare; let pending: Promise<unknown> | undefined, queued = false;
  db.prepare = ((...args: Parameters<Database["prepare"]>) => {
    if (!queued) { queued = true;
      pending = new Promise((resolve, reject) => queueMicrotask(() => {
        adapter.appendTaskPackRevision({ ...content, sourceKind: "manual_edit", taskPackId: first, baseRevisionId: baseRevision.id,
          rawTask: "Concurrent next task", createdAt: time(), generatedAt: null }).then(resolve, reject);
      }));
    }
    return original.apply(db, args);
  }) as typeof db.prepare;
  let value: WorkspaceBackupStorageSnapshot;
  try { value = await snapshot(); } finally { db.prepare = original; }
  await pending;
  assert.equal(value!.taskPackAggregates[0].currentRevisionId, baseRevision.id);
  assert.equal(value!.taskPackRevisions.filter(r => r.taskPackId === first).length, 2); validate(value!);
  const newer = await snapshot(); assert.notEqual(newer.taskPackAggregates[0].currentRevisionId, baseRevision.id); validate(newer);
});
scenario("SQLite BEGIN failure never rolls back another owner's transaction", async () => {
  db.run("BEGIN IMMEDIATE;");
  db.run("UPDATE task_packs SET title = ? WHERE id = ?", ["Foreign pending edit", first]);
  const original = db.run; const calls: string[] = [];
  db.run = ((...args: Parameters<Database["run"]>) => { calls.push(String(args[0])); return original.apply(db, args); }) as typeof db.run;
  try { await assert.rejects(snapshot()); assert.deepEqual(calls, ["BEGIN DEFERRED;"]);
    assert.equal(rows("task_packs")[0].title, "Foreign pending edit");
    original.call(db, "UPDATE task_packs SET title = title WHERE id = ?", [first]);
  } finally { db.run = original; db.run("ROLLBACK;"); }
});
scenario("SQLite COMMIT failure rolls back its owned transaction", async () => {
  const original = db.run, failure = new Error("Synthetic commit failure"), calls: string[] = [];
  db.run = ((...args: Parameters<Database["run"]>) => {
    const sql = String(args[0]); calls.push(sql);
    if (sql === "COMMIT;") throw failure;
    return original.apply(db, args);
  }) as typeof db.run;
  try { await assert.rejects(snapshot(), error => error === failure); assert.deepEqual(calls, ["BEGIN DEFERRED;", "COMMIT;", "ROLLBACK;"]); }
  finally { db.run = original; }
  await snapshot();
});
scenario("SQLite owned read failure rolls back and preserves original failure", async () => {
  const failure = new Error("Synthetic private read failure"); const original = db.prepare;
  db.prepare = (() => { throw failure; }) as typeof db.prepare;
  try { await assert.rejects(snapshot(), error => error === failure); } finally { db.prepare = original; }
  await snapshot(); // No abandoned transaction.
});
scenario("SQLite rollback failure does not replace original read failure", async () => {
  const failure = new Error("Original failure"), originalPrepare = db.prepare, originalRun = db.run;
  db.prepare = (() => { throw failure; }) as typeof db.prepare;
  db.run = ((...args: Parameters<Database["run"]>) => {
    if (String(args[0]).startsWith("ROLLBACK")) throw new Error("Rollback failure"); return originalRun.apply(db,args);
  }) as typeof db.run;
  try { await assert.rejects(snapshot(), error => error === failure); }
  finally { db.prepare = originalPrepare; db.run = originalRun; db.run("ROLLBACK;"); }
});
scenario("SQLite malformed project JSON fails instead of mapper fallback/default repair", async () => {
  const old = rows("projects")[0].readiness_report;
  db.run("UPDATE projects SET readiness_report = 'invalid-json' WHERE id = ?", [projectId]);
  try { await assert.rejects(snapshot()); } finally { db.run("UPDATE projects SET readiness_report = ? WHERE id = ?", [old as string,projectId]); }
});
scenario("SQLite malformed aggregate mapping aborts without persistence or repair", async () => {
  const original = db.prepare;
  db.prepare = ((...args: Parameters<Database["prepare"]>) => {
    const statement = original.apply(db, args);
    if (String(args[0]).includes("FROM task_packs ")) {
      const get = statement.getAsObject;
      statement.getAsObject = (...params: Parameters<typeof get>) => ({ ...get.apply(statement, params), archived_from_state: "completed" });
    }
    return statement;
  }) as typeof db.prepare;
  try { await assert.rejects(snapshot()); }
  finally { db.prepare = original; }
  assert.equal(rows("task_packs")[0].archived_from_state, null); await snapshot();
});

type Row = Record<string, unknown>;
type Dataset = Record<string, Row[]>;
function pgDataset(): Dataset {
  const data: Dataset = {};
  for (const table of ["projects","project_memories","task_packs","task_pack_revisions","task_pack_lifecycle_events","task_pack_revision_review_events"]) {
    const ordering: Record<string,string> = { projects:"id", project_memories:"project_id, id", task_packs:"id",
      task_pack_revisions:"task_pack_id, revision_number, id", task_pack_lifecycle_events:"task_pack_id, created_at, id",
      task_pack_revision_review_events:"task_pack_id, revision_id, created_at, id" };
    const stmt = db.prepare(`SELECT * FROM ${table} ORDER BY ${ordering[table]}`);
    try { const result = []; while(stmt.step()) result.push(stmt.getAsObject()); data[table] = result; } finally {stmt.free();}
  }
  data.projects = data.projects.map(row => ({ ...row, localPath:row.local_path, packageManager:row.package_manager,
    detectedStack:JSON.parse(row.detected_stack as string), scripts:JSON.parse(row.scripts as string), readinessScore:row.readiness_score,
    readinessReport:JSON.parse(row.readiness_report as string), createdAt:new Date(row.created_at as string), updatedAt:new Date(row.updated_at as string),
    lastScanAt:row.last_scan_at === null ? null : new Date(row.last_scan_at as string) }));
  data.project_memories = data.project_memories.map(row => ({ ...row, projectId:row.project_id, isEnabled:Boolean(row.is_enabled),
    createdAt:new Date(row.created_at as string),updatedAt:new Date(row.updated_at as string) }));
  data.task_packs = data.task_packs.map(row => ({...row, lifecycle_version:String(row.lifecycle_version)}));
  data.task_pack_revisions = data.task_pack_revisions.map(row => ({...row,generation_used_fallback:Boolean(row.generation_used_fallback)}));
  return data;
}
class PgClient {
  calls: string[] = []; releases = 0; frozen: Dataset = {};
  constructor(readonly live: Dataset, readonly failureAt?: string, readonly rollbackFails = false) {}
  readonly failure = new Error("Synthetic private PostgreSQL failure");
  async query(sql: string) {
    this.calls.push(sql);
    if (sql.startsWith("BEGIN")) this.frozen = structuredClone(this.live);
    if (this.failureAt && sql.replace(/\s+/gu, " ").includes(this.failureAt)) throw this.failure;
    if (sql.startsWith("ROLLBACK") && this.rollbackFails) throw new Error("Rollback failure");
    if (sql.startsWith("SELECT" ) || sql.trimStart().startsWith("SELECT")) {
      const table = /FROM\s+(\w+)/iu.exec(sql)![1];
      if (table === "projects") this.live.task_packs[0] && (this.live.task_packs[0].current_revision_id = 999999);
      return { rows: structuredClone(this.frozen[table]) };
    }
    return {rows:[]};
  }
  release() {this.releases++;}
}
async function withPg(client: PgClient, check: (adapter: PostgresStorageAdapter) => Promise<void>) {
  const connect = pool.connect, query = pool.query; let connects = 0;
  pool.connect = (async () => { connects++; return client; }) as unknown as typeof pool.connect;
  pool.query = (() => {throw new Error("No pool-level snapshot queries");}) as typeof pool.query;
  try {await check(new PostgresStorageAdapter()); assert.equal(connects,1); assert.equal(client.releases,1);}
  finally {pool.connect=connect;pool.query=query;}
}
scenario("PostgreSQL one READ ONLY REPEATABLE READ client, six reads, success commit/release and SQLite parity", async () => {
  const expected = await snapshot(), client = new PgClient(pgDataset());
  await withPg(client, async pg => {assert.deepEqual(await pg.getWorkspaceBackupSnapshot(),expected);});
  assert.equal(client.calls[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;");
  assert.equal(client.calls.at(-1),"COMMIT;");assert.equal(client.calls.length,8);
  assert.equal(client.calls.filter(sql=>/\bSELECT\b/u.test(sql)).length,6);
  assert.ok(client.calls.filter(sql=>/\bSELECT\b/u.test(sql)).every(sql=>/ORDER BY/u.test(sql)));
  assert.ok(client.calls.every(sql=>!(/FOR UPDATE|INSERT|UPDATE|DELETE|CREATE|ALTER/u.test(sql))));
});
scenario("PostgreSQL concurrent live mutation cannot mix frozen repeatable snapshot pieces", async () => {
  const expected = await snapshot(), live = pgDataset(), client = new PgClient(live);
  await withPg(client, async pg => {const value=await pg.getWorkspaceBackupSnapshot();assert.deepEqual(value,expected);validate(value);});
  assert.equal(live.task_packs[0].current_revision_id,999999);
});
scenario("PostgreSQL empty snapshot retains all six arrays with the same bounded query count", async () => {
  const data=Object.fromEntries(Object.keys(pgDataset()).map(table=>[table,[]])),client=new PgClient(data);
  await withPg(client,async pg=>{const value=await pg.getWorkspaceBackupSnapshot();assert.ok(Object.values(value).every(items=>items.length===0));validate(value);});
  assert.equal(client.calls.length,8);
});
for(const table of ["projects","project_memories","task_packs","task_pack_revisions","task_pack_lifecycle_events","task_pack_revision_review_events"])
  scenario(`PostgreSQL ${table} failure rolls back/releases and preserves original error`,async()=>{
    const client=new PgClient(pgDataset(),`FROM ${table} `);
    await withPg(client,pg=>assert.rejects(pg.getWorkspaceBackupSnapshot(),error=>error===client.failure));
    assert.equal(client.calls.at(-1),"ROLLBACK;");assert.equal(client.calls.includes("COMMIT;"),false);
  });
scenario("PostgreSQL rollback failure preserves original error and releases",async()=>{
  const client=new PgClient(pgDataset(),"FROM projects",true);
  await withPg(client,pg=>assert.rejects(pg.getWorkspaceBackupSnapshot(),error=>error===client.failure));
});
scenario("PostgreSQL BEGIN failure releases but does not rollback an unowned transaction",async()=>{
  const client=new PgClient(pgDataset(),"BEGIN");
  await withPg(client,pg=>assert.rejects(pg.getWorkspaceBackupSnapshot(),error=>error===client.failure));assert.equal(client.calls.length,1);
});
scenario("PostgreSQL connect failure propagates unchanged without querying or retrying", async () => {
  const original = pool.connect, failure = new Error("Synthetic connect failure"); let calls = 0;
  pool.connect = (async () => { calls++; throw failure; }) as typeof pool.connect;
  try { await assert.rejects(new PostgresStorageAdapter().getWorkspaceBackupSnapshot(), error => error === failure); assert.equal(calls, 1); }
  finally { pool.connect = original; }
});
scenario("PostgreSQL commit failure rolls back and releases",async()=>{
  const client=new PgClient(pgDataset(),"COMMIT");
  await withPg(client,pg=>assert.rejects(pg.getWorkspaceBackupSnapshot(),error=>error===client.failure));assert.equal(client.calls.at(-1),"ROLLBACK;");
});
scenario("PostgreSQL malformed row mapping rolls back without default repair",async()=>{
  const data=pgDataset();data.task_packs[0].current_revision_id=null;const client=new PgClient(data);
  await withPg(client,pg=>assert.rejects(pg.getWorkspaceBackupSnapshot()));assert.equal(client.calls.at(-1),"ROLLBACK;");
});
scenario("PostgreSQL BIGINT lifecycleVersion maps safely without changing stored value",async()=>{
  const data=pgDataset();data.task_packs[0].lifecycle_version=String(Number.MAX_SAFE_INTEGER);const client=new PgClient(data);
  await withPg(client,async pg=>{assert.equal((await pg.getWorkspaceBackupSnapshot()).taskPackAggregates[0].lifecycleVersion,Number.MAX_SAFE_INTEGER);});
});
scenario("source contracts: no awaited SQLite owned work or writer semantics changes; only six bounded relational reads",()=>{
  for(const name of ["SqliteStorageAdapter","PostgresStorageAdapter"]){
    const source=fs.readFileSync(new URL(`${name}.ts`,import.meta.url),"utf8");
    const method=source.slice(source.indexOf("  async getWorkspaceBackupSnapshot("),source.indexOf("  async listProjects("));
    assert.doesNotMatch(method,/this\.(?:list|getAll|ensureSchema|persist)|FOR UPDATE|INSERT|UPDATE|DELETE|task_pack_drafts|github_created_issue_links|app_settings/);
    if(name==="SqliteStorageAdapter"){
      const owned=method.slice(method.indexOf('db.run("BEGIN DEFERRED;'));
      assert.doesNotMatch(owned,/await\s+|Promise\.|queueMicrotask|setTimeout/);
      assert.match(source,/db\.run\("BEGIN IMMEDIATE;"\)/);assert.match(source,/const result = await work\(\);[\s\S]*?this\.persist\(\)/);
    }else{assert.doesNotMatch(method,/pool\.query/);assert.match(method,/finally \{ client.release\(\); \}/);}
  }
});
try {
  await adapter.ensureSchema();db=(adapter as unknown as {db:Database}).db;
  for(const {name,run}of scenarios){await run();console.log(`PASS ${name}`);}
  console.log(`Workspace backup snapshot smoke: ${scenarios.length}/${scenarios.length} passed (real SQLite; PostgreSQL fake-client/source, no live PostgreSQL).`);
} finally { if(db!)db.close();fs.rmSync(root,{recursive:true,force:true}); }
