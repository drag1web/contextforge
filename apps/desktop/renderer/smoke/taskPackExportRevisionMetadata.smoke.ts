import assert from "node:assert/strict";
import type { TaskPack, TaskPackGenerationRecipe } from "../src/types";
import {
  createTaskPackExportContent,
  getTaskPackExportFileName,
  type TaskPackExportFormat,
} from "../src/utils/taskPackExport";

let scenarios = 0;
function scenario(name: string, run: () => void) {
  run(); scenarios++; process.stdout.write(`PASS ${name}\n`);
}

const recipe: TaskPackGenerationRecipe = {
  template: { id: "fixture-template", name: "Fixture template", targetTool: "codex", taskType: "bugfix", isBuiltin: false },
  ruleProfile: { id: "fixture-profile", name: "Fixture profile", taskType: "bugfix", isBuiltin: false },
  enabledRules: [{ id: "fixture-rule", title: "Fixture rule", category: "bugfix" }],
  customRules: ["fixture custom rule"], acceptanceCriteriaPreset: null, acceptanceCriteria: ["fixture criterion"],
  counts: { enabledRules: 2, customRules: 3, acceptanceCriteria: 4 },
  taskClarifications: [{ question: "Which boundary?", answer: "The current projection." }],
};
const pack: TaskPack = {
  id: 123, currentRevisionId: 456, projectId: 789, projectName: "Fixture Project",
  title: "Revision export fixture", taskType: "bugfix", targetTool: "codex", generationMode: "ollama",
  generationModel: "fixture-model", generationRecipe: recipe,
  rawTask: "  RAW_START\tзадача\r\n\r\nraw last line  \n",
  generatedPrompt: "\t# PROMPT_START\r\n\r\n**Unicode: 文 / ё**\t\r\nprompt last line  \r\n",
  createdAt: "2026-01-02T03:04:05.000Z", updatedAt: "2026-01-03T06:07:08.000Z",
};
const original = structuredClone(pack);
const privateSentinel = "PRIVATE_METADATA_NOT_FOR_TEXT_EXPORT";
const privateRoot = "C:\\Users\\example\\secret-project";
const privatePack = Object.assign(structuredClone(pack), {
  projectLocalPath: privateRoot,
  selectorDiagnostics: { value: privateSentinel }, generationDiagnostics: { value: privateSentinel },
  performanceDiagnostics: { value: privateSentinel }, groundedContextSnapshot: { value: privateSentinel },
  providerApiKey: privateSentinel, providerEndpointUrl: privateSentinel, githubAccount: { value: privateSentinel },
  lifecycleVersion: 991, lifecycleState: "archived", acceptedRevisionId: 999, revisionNumber: 88,
  contentHash: privateSentinel, reviewState: "accepted", baseRevisionId: 998, sourceKind: "manual_edit",
  arbitraryNestedPrivate: { localRoot: privateRoot, value: privateSentinel },
});
privatePack.generationRecipe = Object.assign(structuredClone(recipe), {
  arbitraryNestedPrivate: { localRoot: privateRoot, value: privateSentinel },
  selectorDiagnostics: { value: privateSentinel }, generationDiagnostics: { value: privateSentinel },
  performanceDiagnostics: { value: privateSentinel }, githubIssue: { value: privateSentinel },
});

function metadata(format: TaskPackExportFormat, label: string, value: string | number) {
  return format === "txt" ? `${label}: ${value}` : `- **${label}:** ${value}`;
}
function section(text: string, start: string, end: string) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `Missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to >= 0, `Missing section end: ${end}`);
  return text.slice(from + start.length, to);
}
// Compare artifact structure without binding assertions to wall-clock time.
function withoutExportTime(text: string) {
  return text.replace(/^(Exported: |- \*\*Exported:\*\* ).+$/m, "$1<FIXED_EXPORT_TIME>");
}

for (const format of ["txt", "md"] as const) {
  const content = createTaskPackExportContent(pack, format);
  scenario(`${format}: exact decimal aggregate/revision pair, distinct from project ID`, () => {
    for (const [label, value] of [["Task Pack ID", 123], ["Revision ID", 456]] as const) {
      assert.ok(content.split("\n").includes(metadata(format, label, value)));
    }
    assert.ok(!content.includes(metadata(format, "Revision ID", pack.id)));
    assert.ok(!content.includes(metadata(format, "Task Pack ID", pack.projectId)));
  });
  scenario(`${format}: identity is inside the existing readable metadata section`, () => {
    if (format === "md") {
      assert.ok(section(content, "## Metadata\n\n", "\n\n## Raw task").includes("- **Revision ID:** 456"));
    } else {
      assert.ok(section(content, "CONTEXTFORGE TASK PACK\n======================\n\n", "\n\nRAW TASK").includes("Revision ID: 456"));
    }
  });
  scenario(`${format}: compatibility object without currentRevisionId exports unavailable identity`, () => {
    const legacy = { ...pack }; delete legacy.currentRevisionId;
    const exported = createTaskPackExportContent(legacy, format);
    assert.ok(exported.split("\n").includes(metadata(format, "Revision ID", "—")));
    assert.ok(exported.includes(metadata(format, "Task Pack ID", pack.id)));
    assert.ok(!exported.includes(metadata(format, "Revision ID", pack.id)));
  });
  scenario(`${format}: malformed revision identity is never coerced or fabricated`, () => {
    for (const currentRevisionId of [null, undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "456", "4.56e2", {}]) {
      const runtimeInput = Object.assign({}, pack, { currentRevisionId }) as unknown as TaskPack;
      const exported = createTaskPackExportContent(runtimeInput, format);
      assert.ok(exported.split("\n").includes(metadata(format, "Revision ID", "—")));
    }
  });
  scenario(`${format}: positive safe integer boundaries are exact decimals`, () => {
    for (const id of [1, Number.MAX_SAFE_INTEGER]) {
      const exported = createTaskPackExportContent({ ...pack, id, currentRevisionId: id }, format);
      assert.ok(exported.split("\n").includes(metadata(format, "Task Pack ID", String(id))));
      assert.ok(exported.split("\n").includes(metadata(format, "Revision ID", String(id))));
    }
  });
  scenario(`${format}: exact raw task retains surrounding whitespace, CRLF, tabs and Unicode`, () => {
    const raw = format === "txt"
      ? section(content, "RAW TASK\n--------\n", "\n\nUSER CLARIFICATIONS")
      : section(content, "## Raw task\n\n", "\n\n## User clarifications");
    assert.equal(raw, pack.rawTask);
  });
  scenario(`${format}: exact generated document retains surrounding whitespace and line endings`, () => {
    const marker = format === "txt" ? "GENERATED PROMPT\n----------------\n" : "\n\n---\n\n";
    assert.equal(content.slice(content.indexOf(marker) + marker.length, -1), pack.generatedPrompt);
  });
  for (const whitespace of ["   ", "\t", "\r\n", "\t\r\n ", " \t\r\n "]) {
    scenario(`${format}: whitespace-only rawTask ${JSON.stringify(whitespace)} uses exact legacy fallback`, () => {
      const exported = createTaskPackExportContent({ ...pack, rawTask: whitespace }, format);
      const raw = format === "txt"
        ? section(exported, "RAW TASK\n--------\n", "\n\nUSER CLARIFICATIONS")
        : section(exported, "## Raw task\n\n", "\n\n## User clarifications");
      assert.equal(raw, "—");
      const marker = format === "txt" ? "GENERATED PROMPT\n----------------\n" : "\n\n---\n\n";
      assert.equal(exported.slice(exported.indexOf(marker) + marker.length, -1), pack.generatedPrompt);
    });
    scenario(`${format}: whitespace-only generatedPrompt ${JSON.stringify(whitespace)} uses exact legacy fallback`, () => {
      const exported = createTaskPackExportContent({ ...pack, generatedPrompt: whitespace }, format);
      const marker = format === "txt" ? "GENERATED PROMPT\n----------------\n" : "\n\n---\n\n";
      assert.equal(exported.slice(exported.indexOf(marker) + marker.length, -1),
        format === "txt" ? "—" : "_No generated prompt body was saved._");
      const raw = format === "txt"
        ? section(exported, "RAW TASK\n--------\n", "\n\nUSER CLARIFICATIONS")
        : section(exported, "## Raw task\n\n", "\n\n## User clarifications");
      assert.equal(raw, pack.rawTask);
    });
  }
  scenario(`${format}: identity and both authored fields come from the same supplied projection`, () => {
    const next = { ...pack, id: 321, currentRevisionId: 654, rawTask: "NEXT_RAW", generatedPrompt: "NEXT_PROMPT" };
    const exported = createTaskPackExportContent(next, format);
    for (const [label, value] of [["Task Pack ID", 321], ["Revision ID", 654]] as const) assert.ok(exported.includes(metadata(format, label, value)));
    assert.ok(exported.includes(next.rawTask) && exported.includes(next.generatedPrompt));
    assert.ok(!exported.includes("RAW_START") && !exported.includes("PROMPT_START"));
  });
  scenario(`${format}: title, project, tool, task type and generation metadata remain`, () => {
    assert.ok(content.includes(pack.title));
    for (const [label, value] of [["Project", "Fixture Project"], ["Target tool", "codex"], ["Task type", "bugfix"],
      ["Generation mode", "ollama"], ["Model", "fixture-model"], ["Created", pack.createdAt]]) {
      assert.ok(content.includes(metadata(format, label, value)));
    }
  });
  scenario(`${format}: clarifications and selected recipe summary remain readable`, () => {
    assert.ok(content.includes("Which boundary?") && content.includes("The current projection."));
    for (const [label, value] of [["Template", "Fixture template"], ["Rule profile", "Fixture profile"],
      ["Enabled rules", 2], ["Custom rules", 3], ["Acceptance criteria", 4]] as const) assert.ok(content.includes(metadata(format, label, value)));
  });
  scenario(`${format}: arbitrary root, diagnostics, credential and integration metadata do not enter text`, () => {
    const exported = createTaskPackExportContent(privatePack, format);
    assert.ok(!exported.includes(privateRoot) && !exported.includes(privateSentinel));
    assert.equal(withoutExportTime(exported), withoutExportTime(content));
  });
  scenario(`${format}: entire TaskPack/recipe are not serialized and history authority is not decorated`, () => {
    assert.doesNotMatch(content, /revisionNumber|sourceKind|contentHash|reviewState|lifecycleState|acceptedRevisionId|baseRevisionId/);
    assert.ok(!content.includes(recipe.enabledRules[0].id) && !content.includes(recipe.customRules[0]));
    const poisonous = Object.assign({}, pack, { toJSON() { throw new Error("Whole TaskPack serialization is forbidden"); } });
    const poisonousRecipe = Object.assign({}, recipe, { toJSON() { throw new Error("Whole recipe serialization is forbidden"); } });
    assert.doesNotThrow(() => createTaskPackExportContent({ ...poisonous, generationRecipe: poisonousRecipe }, format));
  });
  scenario(`${format}: authored path text is not scanned, rewritten or redacted`, () => {
    const authored = `  user-authored C:\\work\\authored-project\t\r\n`;
    const exported = createTaskPackExportContent({ ...pack, rawTask: authored, generatedPrompt: authored }, format);
    assert.equal(exported.split(authored).length - 1, 2);
  });
  scenario(`${format}: filenames preserve the previous convention without revision identity`, () => {
    const expected = `contextforge-fixture-project-revision-export-fixture-2026-01-02.${format}`;
    assert.equal(getTaskPackExportFileName(pack, format), expected);
    assert.equal(getTaskPackExportFileName({ ...pack, id: 321, currentRevisionId: 654 }, format), expected);
    const legacy = { ...pack }; delete legacy.currentRevisionId;
    assert.equal(getTaskPackExportFileName(legacy, format), expected);
  });
  scenario(`${format}: project/title fallback filenames and display metadata are unchanged`, () => {
    const legacy = { ...pack, projectName: undefined, title: "" };
    assert.equal(getTaskPackExportFileName(legacy, format), `contextforge-project-789-task-pack-2026-01-02.${format}`);
    assert.ok(createTaskPackExportContent(legacy, format).includes(metadata(format, "Project", "Project #789")));
  });
  scenario(`${format}: missing recipe, generation defaults and empty-content fallbacks remain`, () => {
    const exported = createTaskPackExportContent({ ...pack, generationRecipe: null, generationMode: undefined,
      generationModel: null, rawTask: "", generatedPrompt: "" }, format);
    assert.ok(exported.includes(metadata(format, "Generation mode", "template")));
    assert.ok(exported.includes(metadata(format, "Model", "—")));
    assert.ok(!exported.includes(format === "txt" ? "USER CLARIFICATIONS" : "## User clarifications"));
    assert.ok(exported.includes(format === "txt" ? "GENERATED PROMPT\n----------------\n—" : "_No generated prompt body was saved._"));
  });
  scenario(`${format}: stays readable text with existing sections, no JSON envelope/frontmatter`, () => {
    assert.ok(content.startsWith(format === "txt" ? "CONTEXTFORGE TASK PACK\n" : `# ${pack.title}\n`));
    assert.throws(() => JSON.parse(content));
    assert.ok(!content.startsWith("---\n"));
    for (const heading of format === "txt" ? ["RAW TASK", "USER CLARIFICATIONS", "RECIPE", "GENERATED PROMPT"]
      : ["## Metadata", "## Raw task", "## User clarifications", "## Recipe"]) assert.ok(content.includes(heading));
  });
}
scenario("content and filename generation leave the original projection and recipe unchanged", () => {
  assert.deepEqual(pack, original);
});
process.stdout.write(`Task Pack export revision metadata smoke passed: ${scenarios} scenarios (pure content/filename functions; no browser download).\n`);
