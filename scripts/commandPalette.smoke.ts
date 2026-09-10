import assert from "node:assert/strict";

import type {
  Project,
  TaskPack,
} from "../apps/desktop/renderer/src/types/index.ts";
import type { TaskPackFreshness } from "../apps/desktop/renderer/src/utils/taskPackFreshness.ts";
import {
  COMMAND_PALETTE_RESULT_LIMIT,
  buildCommandPaletteCommands,
  executeCommandPaletteCommand,
  filterCommandPaletteCommands,
  hasDuplicateCommandIds,
  type CommandPaletteCommand,
  type CommandPaletteBuilderInput,
} from "../apps/desktop/renderer/src/utils/commandPalette.ts";

let scenarios = 0;
function scenario(name: string, run: () => void) {
  run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function project(id: number, name: string): Project {
  return {
    id,
    name,
    localPath: `C:/workspace/${name}`,
    packageManager: "npm",
    detectedStack: ["React", "TypeScript"],
    scripts: {},
    readinessScore: 82,
    readinessReport: {} as Project["readinessReport"],
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    lastScanAt: "2026-09-01T10:00:00.000Z",
  };
}

function taskPack(id: number, projectId: number): TaskPack {
  return {
    id,
    projectId,
    projectName: "Atlas",
    title: `Task Pack ${id}`,
    rawTask: "Review the workspace",
    taskType: "refactor",
    targetTool: "Codex",
    generatedPrompt: "Grounded prompt",
    createdAt: `2026-09-0${id}T10:00:00.000Z`,
    updatedAt: `2026-09-0${id}T10:00:00.000Z`,
  };
}

function translate(key: string, options?: Record<string, unknown>) {
  return [key, options?.name, options?.title, options?.page, options?.count]
    .filter((value) => value !== undefined)
    .join(" ");
}

function builderInput(
  overrides: Partial<CommandPaletteBuilderInput> = {},
) {
  const noop = () => undefined;
  return {
    activePage: "dashboard" as const,
    projects: [] as Project[],
    taskPacks: [] as TaskPack[],
    currentProject: null,
    taskPackFreshnessById: new Map<number, TaskPackFreshness>(),
    canGoBack: false,
    canGoForward: false,
    isWorkspaceBusy: false,
    isFocusModeAvailable: false,
    isFocusModeActive: false,
    t: translate,
    onNavigate: noop,
    onOpenProject: noop,
    onAddProject: noop,
    onRescanProject: noop,
    onCreateTaskPack: noop,
    onOpenTaskPack: noop,
    onOpenGlobalSearch: noop,
    onBack: noop,
    onForward: noop,
    onToggleFocusMode: noop,
    onZoomIn: noop,
    onZoomOut: noop,
    onZoomReset: noop,
    ...overrides,
  } satisfies CommandPaletteBuilderInput;
}

function command(
  id: string,
  label: string,
  keywords: string[] = [],
  priority = 50,
): CommandPaletteCommand {
  return {
    id,
    label,
    description: `${label} description`,
    category: "navigation",
    keywords,
    icon: "page",
    enabled: true,
    contextual: false,
    showWhenEmpty: true,
    priority,
    execute: () => undefined,
  };
}

scenario("empty query returns a bounded useful command set", () => {
  const commands = buildCommandPaletteCommands(builderInput());
  const results = filterCommandPaletteCommands(commands, "");
  assert.ok(results.length > 0);
  assert.ok(results.length <= COMMAND_PALETTE_RESULT_LIMIT);
  assert.ok(results.some((item) => item.id === "workspace.global-search"));
});

scenario("an exact label match ranks first", () => {
  const commands = [
    command("contains", "Open Settings Panel"),
    command("exact", "Open Settings"),
  ];
  assert.equal(filterCommandPaletteCommands(commands, "open settings")[0]?.id, "exact");
});

scenario("a label prefix outranks a keyword-only match", () => {
  const commands = [
    command("keyword", "Preferences", ["open settings"]),
    command("prefix", "Open Settings"),
  ];
  assert.equal(filterCommandPaletteCommands(commands, "open")[0]?.id, "prefix");
});

scenario("project names expose deterministic project switching", () => {
  const atlas = project(1, "Atlas Engine");
  const commands = buildCommandPaletteCommands(
    builderInput({ projects: [atlas] }),
  );
  assert.equal(
    filterCommandPaletteCommands(commands, "atlas")[0]?.id,
    "project.open.1",
  );
});

scenario("disabled commands cannot execute", () => {
  let executions = 0;
  const disabled = {
    ...command("disabled", "Disabled"),
    enabled: false,
    execute: () => {
      executions += 1;
    },
  };
  assert.equal(executeCommandPaletteCommand(disabled), false);
  assert.equal(executions, 0);
});

scenario("current project commands derive only from real context", () => {
  const atlas = project(1, "Atlas");
  const commands = buildCommandPaletteCommands(
    builderInput({ projects: [atlas], currentProject: atlas }),
  );
  assert.ok(commands.some((item) => item.id === "project.rescan.1"));
  assert.ok(commands.some((item) => item.id === "project.create-task-pack.1"));

  const withoutContext = buildCommandPaletteCommands(
    builderInput({ projects: [atlas], currentProject: null }),
  );
  assert.ok(!withoutContext.some((item) => item.id.startsWith("project.rescan.")));
  assert.ok(!withoutContext.some((item) => item.id.startsWith("project.create-task-pack.")));
});

scenario("busy project actions stay visible but cannot execute", () => {
  const atlas = project(1, "Atlas");
  const commands = buildCommandPaletteCommands(
    builderInput({
      projects: [atlas],
      currentProject: atlas,
      isWorkspaceBusy: true,
    }),
  );
  const rescan = commands.find((item) => item.id === "project.rescan.1");
  assert.equal(rescan?.enabled, false);
  assert.match(rescan?.disabledReason ?? "", /workspaceBusy/);
});

scenario("zoom commands call the supplied central zoom actions", () => {
  const calls: string[] = [];
  const commands = buildCommandPaletteCommands(
    builderInput({
      onZoomIn: () => calls.push("in"),
      onZoomOut: () => calls.push("out"),
      onZoomReset: () => calls.push("reset"),
    }),
  );
  for (const id of ["workspace.zoom-in", "workspace.zoom-out", "workspace.zoom-reset"]) {
    const item = commands.find((candidate) => candidate.id === id);
    assert.ok(item);
    executeCommandPaletteCommand(item);
  }
  assert.deepEqual(calls, ["in", "out", "reset"]);
});

scenario("Global Search remains discoverable as a separate command", () => {
  const commands = buildCommandPaletteCommands(builderInput());
  const search = commands.find((item) => item.id === "workspace.global-search");
  assert.equal(search?.shortcutId, "globalSearch");
  assert.equal(search?.enabled, true);
});

scenario("Focus Mode is exposed only on supported workflow surfaces", () => {
  const unavailable = buildCommandPaletteCommands(builderInput());
  assert.ok(!unavailable.some((item) => item.id === "workspace.focus-mode"));
  const available = buildCommandPaletteCommands(
    builderInput({ isFocusModeAvailable: true }),
  );
  assert.ok(available.some((item) => item.id === "workspace.focus-mode"));
});

scenario("Task Pack freshness consumes the existing central state", () => {
  const pack = taskPack(1, 1);
  const freshness: TaskPackFreshness = {
    taskPackId: pack.id,
    projectId: pack.projectId,
    status: "affected",
    reason: "removed_context_path",
    selectedPaths: ["src/index.ts"],
    affectedPaths: ["src/index.ts"],
    createdAt: pack.createdAt,
    previousObservedAt: "2026-09-02T10:00:00.000Z",
    currentObservedAt: "2026-09-03T10:00:00.000Z",
  };
  const commands = buildCommandPaletteCommands(
    builderInput({
      taskPacks: [pack],
      taskPackFreshnessById: new Map([[pack.id, freshness]]),
    }),
  );
  assert.ok(commands.some((item) => item.id === "task-pack.review-freshness"));
});

scenario("result ordering is deterministic", () => {
  const commands = [
    command("z", "Same", [], 10),
    command("a", "Same", [], 10),
    command("first", "First", [], 10),
  ];
  const first = filterCommandPaletteCommands(commands, "").map((item) => item.id);
  const second = filterCommandPaletteCommands(commands, "").map((item) => item.id);
  assert.deepEqual(first, second);
});

scenario("custom result caps are enforced", () => {
  const commands = Array.from({ length: 20 }, (_, index) =>
    command(`command-${index}`, `Command ${index}`),
  );
  assert.equal(filterCommandPaletteCommands(commands, "", 5).length, 5);
});

scenario("generated command IDs remain unique", () => {
  const atlas = project(1, "Atlas");
  const commands = buildCommandPaletteCommands(
    builderInput({
      projects: [atlas],
      currentProject: atlas,
      taskPacks: [taskPack(1, 1), taskPack(2, 1)],
      isFocusModeAvailable: true,
    }),
  );
  assert.equal(hasDuplicateCommandIds(commands), false);
});

process.stdout.write(`Command Palette smoke passed: ${scenarios} scenarios.\n`);
