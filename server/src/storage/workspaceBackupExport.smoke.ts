import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Database } from "sql.js";
import type { TaskPackRevisionContent } from "../taskPacks/taskPackLifecycle.js";
import type { WorkspaceBackupStorageSnapshot } from "./types.js";
import { parseWorkspaceBackup } from "./workspaceBackupReader.js";
import { WORKSPACE_BACKUP_SAFE_SETTING_KEYS } from "./workspaceBackupFormat.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-backup-export-")), originalCwd = process.cwd();
process.env.STORAGE_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = path.join(root, "export.sqlite");
process.chdir(root);
const { storage } = await import("./index.js");
const { exportWorkspaceBackup, getWorkspaceBackupStats } = await import("./workspaceBackup.js");
const { storageRouter } = await import("../routes/storage.js");
const directory = path.join(root, "data", "backups");
const scenarios: { name: string; run: () => void | Promise<void> }[] = [];
const scenario = (name: string, run: () => void | Promise<void>) => scenarios.push({ name, run });
const disk = () => fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
const jsonFiles = () => disk().filter(name => name.endsWith(".json"));
let projectId: number, first: number, second: number, serial = 0;
const time = () => new Date(Date.UTC(2030, 0, 1) + ++serial * 1000).toISOString();
const content: TaskPackRevisionContent = { sourceKind: "generated", rawTask: "  Задача\r\n\tTask  ", taskType: "tests",
  targetTool: "generic", generatedPrompt: "# Exact\r\n\tDocument  ", generationMode: "template", generationModel: null,
  generationMessage: " Exact historical message\r\n", generationUsedFallback: false, generationDurationMs: 1.25,
  generationRecipe: { githubIssue: { number: 12, htmlUrl: "https://example.invalid/source" },
    githubCreatedIssue: { number: 13, htmlUrl: "https://example.invalid/historical" }, authored: "Synthetic authored private value" },
  diagnostics: { selector: { exact: "historical diagnostic" }, generation: null, performance: { durationMs: 1.25 } },
  groundedContextSnapshot: { schemaVersion: 1, selectorEngine: "manual", selectorConfigurationFingerprint: null,
    repositoryObservationFingerprint: null, repositorySnapshotFingerprint: null, selectorSnapshotFingerprint: null,
    selectedFiles: [{ path: "src/synthetic.ts", role: "reference", usage: "inspect-only", evidenceStrength: "reference", proofClasses: ["inventory_exact"] }] },
  freshnessBasis: { schemaVersion: 1, stateAtCreation: "unknown", projectAwarenessFingerprint: null, inventoryFingerprint: null,
    policyVersion: null, comparisonLimited: true, observedAt: null, previousObservedAt: null } };
const catalog = { version: 1, templates: [{ id: "synthetic", name: "Custom", description: "", targetTool: "generic" as const,
  taskType: "tests" as const, content: "  Exact template\r\n", isBuiltin: false }], ruleItems: [], ruleProfiles: [], acceptanceCriteriaPresets: [] };
async function create(title: string) {
  return (await storage.createTaskPackWithInitialRevision({ projectId, title, generatedAt: time(), revisionContent: content,
    compatibilityGenerationRecipe: { flatOnly: "Synthetic flat overlay" } })).id;
}
async function accept(taskPackId: number) {
  const aggregate = (await storage.getTaskPackAggregate(taskPackId))!;
  await storage.transitionTaskPackRevisionReview({ taskPackId, revisionId: aggregate.currentRevisionId,
    expectedLifecycleVersion: aggregate.lifecycleVersion, expectedReviewState: "unreviewed", transition: { type: "accept" },
    eventId: `review-${++serial}`, source: "user", actorId: "Synthetic actor", metadata: { authored: "Private event metadata" }, createdAt: time() });
}
async function life(taskPackId: number, type: "complete" | "archive") {
  const aggregate = (await storage.getTaskPackAggregate(taskPackId))!;
  await storage.transitionTaskPackAggregateLifecycle({ taskPackId, expectedLifecycleVersion: aggregate.lifecycleVersion,
    transition: { type }, eventId: `lifecycle-${++serial}`, source: "user", actorId: null, metadata: { authored: "Private lifecycle metadata" }, createdAt: time() });
}
async function withSnapshot(value: WorkspaceBackupStorageSnapshot | Error, check: () => Promise<void>) {
  const original = storage.getWorkspaceBackupSnapshot;
  storage.getWorkspaceBackupSnapshot = async () => { if (value instanceof Error) throw value; return value; };
  try { await check(); } finally { storage.getWorkspaceBackupSnapshot = original; }
}
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? Mutable<U>[] : T[K] extends object ? Mutable<T[K]> : T[K] };
const corrupt = (name: string, mutate: (value: Mutable<WorkspaceBackupStorageSnapshot>) => void) => scenario(name, async () => {
  const value = structuredClone(await storage.getWorkspaceBackupSnapshot()) as Mutable<WorkspaceBackupStorageSnapshot>;
  mutate(value); const before = disk();
  await withSnapshot(value, () => assert.rejects(exportWorkspaceBackup())); assert.deepEqual(disk(), before);
});

scenario("empty export is a readable V2 and successful publication leaves only one final JSON", async () => {
  const result = await exportWorkspaceBackup(), text = fs.readFileSync(result.filePath, "utf8"), parsed = parseWorkspaceBackup(text);
  assert.equal(parsed.formatVersion, 2); assert.equal(jsonFiles().length, 1); assert.equal(disk().length, 1);
  assert.deepEqual(result.counts, { projects: 0, taskPacks: 0, revisions: 0, lifecycleEvents: 0, reviewEvents: 0,
    projectMemories: 0, ruleTemplates: 0, settings: 9 });
  assert.equal(result.sizeBytes, Buffer.byteLength(text));
});
scenario("materialized aggregate/history graph, memory and catalog fixture uses ordinary writers only", async () => {
  projectId = (await storage.upsertScannedProject({ name: "Synthetic export", localPath: path.join(root, "project"),
    packageManager: null, detectedStack: [], scripts: {}, readinessScore: 0, readinessReport: { score: 0, checks: [], issues: [] } })).id;
  await storage.createProjectMemory({ projectId, title: "Memory", content: "  Exact private memory\r\n", category: "custom" });
  first = await create("Historical accepted"); await accept(first);
  const original = (await storage.getCurrentTaskPackRevision(first))!;
  await storage.appendTaskPackRevision({ ...content, sourceKind: "manual_edit", taskPackId: first, baseRevisionId: original.id,
    rawTask: "Exact edited\r\n\tTask  ", createdAt: time(), generatedAt: null });
  second = await create("Completed then archived"); await accept(second); await life(second, "complete"); await life(second, "archive");
  const third = await create("Archived active"); await life(third, "archive");
  await storage.writeRulesAndTemplatesCatalog!(catalog);
  await storage.setSettingValue("language", { preservedFutureValue: [null, true, "not an enum"] });
  await storage.setSettingValue("openai_compatible_api_key", "DEDICATED_SYNTHETIC_KEY_DO_NOT_COLLECT");
  await storage.setSettingValue("ollama_url", "DEDICATED_SYNTHETIC_ENDPOINT_DO_NOT_COLLECT");
  await storage.setSettingValue("github_access_token", "DEDICATED_SYNTHETIC_TOKEN_DO_NOT_COLLECT");
  await storage.setSettingValue("github_user_login", "DEDICATED_SYNTHETIC_ACCOUNT_DO_NOT_COLLECT");
});
scenario("V2 exact authoritative arrays, old five plus new three counts and runtime self-validation", async () => {
  const before = await storage.getWorkspaceBackupSnapshot(), result = await exportWorkspaceBackup();
  const parsed = parseWorkspaceBackup(fs.readFileSync(result.filePath, "utf8")); assert.equal(parsed.formatVersion, 2);
  if (parsed.formatVersion !== 2) throw new Error("version");
  const { data } = parsed.backup;
  assert.deepEqual(data.taskPackAggregates, before.taskPackAggregates); assert.deepEqual(data.taskPackRevisions, before.taskPackRevisions);
  assert.deepEqual(data.taskPackLifecycleEvents, before.taskPackLifecycleEvents); assert.deepEqual(data.taskPackReviewEvents, before.taskPackReviewEvents);
  assert.deepEqual(data.projects, before.projects); assert.deepEqual(data.projectMemory, before.projectMemory);
  assert.equal("taskPacks" in data, false); assert.equal(Object.keys(data).length, 8);
  assert.deepEqual(result.counts, { projects: 1, taskPacks: 3, revisions: 4, lifecycleEvents: 3, reviewEvents: 2,
    projectMemories: 1, ruleTemplates: 1, settings: 9 });
  assert.deepEqual(parsed.backup.counts, result.counts);
});
scenario("immutable content/hash, embedded historical GitHub provenance, diagnostics/context/freshness remain exact", async () => {
  const result = await exportWorkspaceBackup(), parsed = parseWorkspaceBackup(fs.readFileSync(result.filePath,"utf8"));
  if (parsed.formatVersion !== 2) throw new Error("version");
  const revision = parsed.backup.data.taskPackRevisions[0], original = (await storage.listTaskPackRevisions(first))[0];
  assert.deepEqual(revision, original); assert.equal(revision.rawTask, content.rawTask); assert.equal(revision.generatedPrompt, content.generatedPrompt);
  assert.deepEqual(revision.generationRecipe, content.generationRecipe); assert.equal(revision.contentHash, original.contentHash);
  assert.deepEqual(revision.diagnostics, content.diagnostics); assert.deepEqual(revision.groundedContextSnapshot, content.groundedContextSnapshot);
  assert.deepEqual(revision.freshnessBasis, content.freshnessBasis); assert.equal(revision.generationDurationMs, 1.25);
});
scenario("safe-settings reads exactly nine keys; export calls one bulk snapshot and no per-item reads", async () => {
  const originals = { snapshot: storage.getWorkspaceBackupSnapshot, settings: storage.getSettingValue, packs:storage.listTaskPacks,
    projects:storage.listProjects, memories:storage.listProjectMemories };
  let calls=0; const keys:string[]=[];
  storage.getWorkspaceBackupSnapshot = async()=>{calls++;return originals.snapshot.call(storage);};
  storage.getSettingValue = async <T>(key:string,fallback:T)=>{keys.push(key);return originals.settings.call(storage,key,fallback) as Promise<T>;};
  const forbiddenRead = async (): Promise<never> => {throw new Error("No per-item/flat reads");};
  storage.listTaskPacks = forbiddenRead; storage.listProjects = forbiddenRead; storage.listProjectMemories = forbiddenRead;
  try {await exportWorkspaceBackup();assert.equal(calls,1);assert.deepEqual(keys,[...WORKSPACE_BACKUP_SAFE_SETTING_KEYS]);}
  finally {storage.getWorkspaceBackupSnapshot=originals.snapshot;storage.getSettingValue=originals.settings;
    storage.listTaskPacks=originals.packs;storage.listProjects=originals.projects;storage.listProjectMemories=originals.memories;}
});
scenario("rules/schema/local project paths preserved; dedicated sensitive settings excluded", async()=>{
  const result=await exportWorkspaceBackup(),text=fs.readFileSync(result.filePath,"utf8"),parsed=parseWorkspaceBackup(text);
  if(parsed.formatVersion!==2)throw new Error("version");
  assert.deepEqual(parsed.backup.data.rulesAndTemplates,catalog);assert.equal(parsed.backup.storage.schema!.currentVersion,6);
  assert.equal(parsed.backup.data.projects[0].localPath,path.join(root,"project"));
  assert.deepEqual(Object.keys(parsed.backup.data.safeSettings),[...WORKSPACE_BACKUP_SAFE_SETTING_KEYS]);
  assert.deepEqual(parsed.backup.data.safeSettings.language,{preservedFutureValue:[null,true,"not an enum"]});
  assert.doesNotMatch(text,/DEDICATED_SYNTHETIC_|Synthetic flat overlay/u);
});
scenario("warnings/included/excluded distinguish private historical content from excluded standalone stores",async()=>{
  const result=await exportWorkspaceBackup(),warnings=result.warnings.join(" ");
  assert.match(warnings,/private local backup/u);assert.match(warnings,/sensitive information entered or generated/u);
  assert.match(warnings,/historical GitHub provenance.*preserved/u);assert.match(warnings,/source files are not copied/u);
  assert.match(warnings,/local paths/u);assert.match(warnings,/Restore\/import is not implemented/u);
  assert.ok(result.included.includes("taskPackRevisions"));assert.ok(!result.included.includes("taskPacks"));
  assert.ok(result.excluded.includes("standaloneTaskPackGitHubCreatedIssueLinks"));assert.ok(result.excluded.includes("persistedTaskPackDrafts"));
});
scenario("standalone link overlay and persisted drafts are not collected by export",async()=>{
  await storage.createTaskPackGitHubCreatedIssueLink({ taskPackId:first, owner:"synthetic", repo:"repo", fullName:"synthetic/repo",
    issueNumber:99,issueTitle:"Standalone integration marker",issueUrl:"https://example.invalid/standalone",issueState:"open",labels:[],
    repositoryUrl:"https://example.invalid/standalone-repository",createdAt:time() });
  await storage.createTaskPackDraft({ id:"synthetic-draft", projectId,taskPackId:null,baseRevisionId:null,expiresAt:null,
    content:{rawTask:"Draft content marker",taskType:"tests",targetTool:"generic",templateId:null,ruleProfileId:null,enabledRuleIds:[],
      customRulesText:null,acceptanceCriteriaPresetId:null,acceptanceCriteriaText:null,clarifications:[],performanceSessionId:null,
      understandingSnapshotId:null,reviewedUnderstandingSnapshotId:null} });
  const result=await exportWorkspaceBackup(),text=fs.readFileSync(result.filePath,"utf8");
  assert.doesNotMatch(text,/Standalone integration marker|standalone-repository|Draft content marker/u);
  assert.ok(text.includes("https://example.invalid/historical"));
});
corrupt("invalid hash fails before any file publication",value=>{value.taskPackRevisions[0].contentHash=`sha256:${"0".repeat(64)}`;});
corrupt("broken current pointer fails before any file publication",value=>{value.taskPackAggregates[0].currentRevisionId=999999;});
corrupt("foreign revision fails before any file publication",value=>{value.taskPackRevisions[0].taskPackId=second;});
corrupt("invalid lifecycle chain fails before any file publication",value=>{value.taskPackLifecycleEvents.shift();});
corrupt("accepted pointer without accepted review evidence fails before publication",value=>{
  value.taskPackAggregates[0].acceptedRevisionId=value.taskPackAggregates[0].currentRevisionId;
});
corrupt("invalid review chain fails before publication",value=>{
  const event=value.taskPackReviewEvents[0];event.fromState="in_review";
});
corrupt("unexpected structural snapshot authority fails closed before publication",value=>{Object.assign(value,{taskPacks:[]});});
scenario("storage failure preserves original error and publishes nothing",async()=>{
  const error=new Error("private SQL driver details /synthetic/private/path");const before=disk();
  await withSnapshot(error,()=>assert.rejects(exportWorkspaceBackup(),failure=>failure===error));assert.deepEqual(disk(),before);
});
scenario("mkdir failure publishes nothing and preserves original failure",async()=>{
  const original=fsp.mkdir,error=new Error("Synthetic mkdir failure"),before=disk();
  fsp.mkdir=(async()=>{throw error;})as typeof fsp.mkdir;
  try{await assert.rejects(exportWorkspaceBackup(),failure=>failure===error);assert.deepEqual(disk(),before);}finally{fsp.mkdir=original;}
});
scenario("partial write failure cleans owned temp and leaves no partial final JSON",async()=>{
  const original=fsp.open,error=new Error("Synthetic write failure"),before=disk();
  fsp.open=async(...args:Parameters<typeof fsp.open>)=>{
    const handle=await original(...args),write=handle.writeFile.bind(handle);
    handle.writeFile=async()=>{await write("partial authored content","utf8");throw error;};return handle;
  };
  try{await assert.rejects(exportWorkspaceBackup(),failure=>failure===error);assert.deepEqual(disk(),before);}finally{fsp.open=original;}
});
scenario("publication failure uses same-directory non-JSON temp, stats ignore it, cleanup preserves error",async()=>{
  const original=fsp.rename,error=new Error("Synthetic rename failure"),before=disk();
  fsp.rename=async(from,to)=>{
    assert.equal(path.dirname(String(from)),path.dirname(String(to)));assert.ok(!String(from).endsWith(".json"));
    assert.ok(fs.existsSync(String(from)));assert.equal(fs.existsSync(String(to)),false);
    assert.equal((await getWorkspaceBackupStats()).count,jsonFiles().length);throw error;
  };
  try{await assert.rejects(exportWorkspaceBackup(),failure=>failure===error);assert.deepEqual(disk(),before);}finally{fsp.rename=original;}
});
scenario("temp cleanup failure remains best-effort and never masks publication error",async()=>{
  const rename=fsp.rename,unlink=fsp.unlink,error=new Error("Primary publication failure"),before=jsonFiles();let temporary="";
  fsp.rename=async(from)=>{temporary=String(from);throw error;};fsp.unlink=async()=>{throw new Error("Cleanup failure");};
  try{await assert.rejects(exportWorkspaceBackup(),failure=>failure===error);assert.deepEqual(jsonFiles(),before);
    assert.equal((await getWorkspaceBackupStats()).count,before.length);assert.ok(fs.existsSync(temporary));}
  finally{fsp.rename=rename;fsp.unlink=unlink;if(temporary)await unlink(temporary);}
});
scenario("exclusive-open failure never deletes another file it did not create",async()=>{
  const open=fsp.open,error=new Error("EEXIST"),before=jsonFiles();let foreign="";
  fsp.open=async(file)=>{foreign=String(file);await fsp.writeFile(foreign,"Foreign temporary file","utf8");throw error;};
  try{await assert.rejects(exportWorkspaceBackup(),failure=>failure===error);assert.deepEqual(jsonFiles(),before);
    assert.equal(fs.readFileSync(foreign,"utf8"),"Foreign temporary file");}
  finally{fsp.open=open;if(foreign)await fsp.unlink(foreign);}
});
scenario("simultaneous exports at identical millisecond timestamps never overwrite each other's final backup",async()=>{
  const iso=Date.prototype.toISOString;Date.prototype.toISOString=()=>"2035-01-01T00:00:00.000Z";
  try{const before=jsonFiles().length,[left,right]=await Promise.all([exportWorkspaceBackup(),exportWorkspaceBackup()]);
    assert.notEqual(left.filePath,right.filePath);assert.equal(left.createdAt,right.createdAt);assert.equal(jsonFiles().length,before+2);
    assert.equal(parseWorkspaceBackup(fs.readFileSync(left.filePath,"utf8")).formatVersion,2);
    assert.equal(parseWorkspaceBackup(fs.readFileSync(right.filePath,"utf8")).formatVersion,2);
    assert.match(left.fileName,/^contextforge-workspace-backup-2035-01-01T00-00-00-000Z-[a-f0-9-]+\.json$/u);
  }finally{Date.prototype.toISOString=iso;}
});
scenario("stats count only final JSON files; SQLite pre-migration and temp artifacts are ignored",async()=>{
  const temporary=path.join(directory,"synthetic.tmp"),migration=path.join(directory,"synthetic.sqlite");
  await fsp.writeFile(temporary,"Synthetic temp");await fsp.writeFile(migration,"Synthetic migration");
  try{assert.equal((await getWorkspaceBackupStats()).count,jsonFiles().length);}
  finally{await fsp.unlink(temporary);await fsp.unlink(migration);}
});
scenario("successful real HTTP export retains Settings-compatible result envelope and additive counts",async()=>{
  const app=express();app.use("/api/storage",storageRouter);const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  try{const response=await fetch(`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/storage/backups/export`,{method:"POST"});
    const body=await response.json();assert.equal(response.status,200);assert.equal(body.ok,true);
    assert.deepEqual(Object.keys(body.backup).sort(),["fileName","filePath","sizeBytes","createdAt","counts","included","excluded","warnings"].sort());
    for(const key of ["projects","taskPacks","projectMemories","ruleTemplates","settings","revisions","lifecycleEvents","reviewEvents"])
      assert.equal(typeof body.backup.counts[key],"number");
    assert.equal(parseWorkspaceBackup(fs.readFileSync(body.backup.filePath,"utf8")).formatVersion,2);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
scenario("real HTTP export failure exposes/logs only fixed public message, no private driver/path/content/cause",async()=>{
  const app=express();app.use("/api/storage",storageRouter);const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  const original=console.error,logs:unknown[][]=[];console.error=(...args)=>{logs.push(args);};
  try{await withSnapshot(new Error("private SQL driver /synthetic/private/path authored payload",{cause:"private cause"}),async()=>{
    const response=await fetch(`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/storage/backups/export`,{method:"POST"});
    const body=await response.json();assert.equal(response.status,500);assert.deepEqual(body,{ok:false,message:"Workspace backup export failed"});
    assert.doesNotMatch(JSON.stringify(body),/SQL|driver|private|stack|cause|payload/u);
    assert.deepEqual(logs,[["Workspace backup export failed"]]);
  });}finally{console.error=original;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
scenario("existing storage audit remains reachable with unchanged response envelope",async()=>{
  const app=express();app.use("/api/storage",storageRouter);const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  try{const response=await fetch(`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/storage/audit`),body=await response.json();
    assert.equal(response.status,200);assert.equal(body.ok,true);assert.ok(Array.isArray(body.audit.counts));assert.equal(body.audit.schema.currentVersion,6);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
scenario("source contracts: exact serialized text validated before filesystem publication; no restore or integration collector",()=>{
  const source=fs.readFileSync(new URL("workspaceBackup.ts",import.meta.url),"utf8");
  assert.ok(source.indexOf("parseWorkspaceBackup(serialized)")<source.indexOf("await fs.mkdir"));
  assert.match(source,/fs\.open\(temporaryPath, "wx"\)/);assert.match(source,/fs\.rename\(temporaryPath, filePath\)/);
  assert.doesNotMatch(source,/storage\.(?:listTaskPacks|listProjects|listProjectMemories|listActiveTaskPackDrafts|getTaskPackGitHubCreatedIssueLink|create|append|update|transition)|restoreWorkspace|importWorkspace/u);
  const route=fs.readFileSync(new URL("../routes/storage.ts",import.meta.url),"utf8");
  assert.equal((route.match(/storageRouter\.post/g)||[]).length,1);assert.doesNotMatch(route.slice(route.indexOf('storageRouter.post("/backups/export"')),/error\.message|String\(error\)/u);
});
try {
  await storage.ensureSchema();
  for(const {name,run}of scenarios){await run();console.log(`PASS ${name}`);}
  console.log(`Workspace backup export smoke: ${scenarios.length}/${scenarios.length} passed (real SQLite/filesystem/HTTP, failure injection).`);
} finally {
  (storage as unknown as {db:Database}).db?.close();process.chdir(originalCwd);fs.rmSync(root,{recursive:true,force:true});
}
