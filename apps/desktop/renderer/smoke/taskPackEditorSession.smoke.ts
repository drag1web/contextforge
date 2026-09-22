import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import type { TaskPack } from "../src/types";
import {
  buildTaskPackEditorUpdate,
  createTaskPackEditorSession,
} from "../src/utils/taskPackEditorSession";

interface SmokeScenario {
  readonly name: string;
  readonly run: () => void;
}

const scenarios: SmokeScenario[] = [];
const scenario = (name: string, run: SmokeScenario["run"]) =>
  scenarios.push({ name, run });

const taskPack: TaskPack = {
  id: 7,
  currentRevisionId: 21,
  projectId: 3,
  title: "Editor session",
  rawTask: "Original task text",
  taskType: "tests",
  targetTool: "codex",
  generatedPrompt: "Original prompt text",
  createdAt: "2026-09-22T10:00:00.000Z",
  updatedAt: "2026-09-22T10:00:00.000Z",
};

scenario("editor session captures its revision token and source once", () => {
  const session = createTaskPackEditorSession(taskPack, "task");
  taskPack.currentRevisionId = 22;
  taskPack.rawTask = "Background refresh text";
  assert.equal(session.expectedCurrentRevisionId, 21);
  assert.equal(session.sourceValue, "Original task text");
  assert.equal(session.taskPack.currentRevisionId, 21);
});

scenario("editor update always carries the captured base revision", () => {
  const session = createTaskPackEditorSession(
    { ...taskPack, currentRevisionId: 31, generatedPrompt: "Base prompt" },
    "prompt",
  );
  assert.deepEqual(buildTaskPackEditorUpdate(session, "Unsaved local prompt"), {
    expectedCurrentRevisionId: 31,
    generatedPrompt: "Unsaved local prompt",
  });
  assert.equal(session.sourceValue, "Base prompt");
});

scenario("missing revision token cannot open an editor session", () => {
  assert.throws(() =>
    createTaskPackEditorSession(
      { ...taskPack, currentRevisionId: undefined },
      "task",
    ),
  );
});

scenario("result page keeps session state independent from parent refresh", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "pages", "TaskPackResultPage.tsx"),
    "utf8",
  );
  assert.ok(source.includes("setEditorSession(createTaskPackEditorSession"));
  assert.ok(source.includes("taskPackForSession = await getTaskPack"));
  assert.ok(source.includes("buildTaskPackEditorUpdate(session, trimmedValue)"));
  assert.equal(source.includes("}, [kind, sourceValue]);"), false);
  assert.ok(source.includes("setError("));
});

for (const entry of scenarios) {
  entry.run();
  process.stdout.write(`PASS ${entry.name}\n`);
}
process.stdout.write(
  `Task Pack editor revision-token smoke passed: ${scenarios.length} scenarios.\n`,
);
