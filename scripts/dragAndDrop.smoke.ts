import assert from "node:assert/strict";

import {
  CONTEXTFORGE_DRAG_MIME,
  CONTEXTFORGE_PROJECT_FILE_DRAG_MIME,
  classifyContextBasketDrop,
  createProjectFileDragPayload,
  hasContextForgeProjectFileDrag,
  hasExternalFileDrag,
  normalizeDroppedRepositoryPath,
  parseContextForgeDragPayload,
  readContextForgeDragPayload,
  writeContextForgeDragPayload,
} from "../apps/desktop/renderer/src/utils/dragAndDrop.ts";

let scenarios = 0;

function scenario(name: string, run: () => void) {
  run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function fakeTransfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: "uninitialized",
    get types() {
      return [...values.keys()];
    },
    getData(type: string) {
      return values.get(type) ?? "";
    },
    setData(type: string, value: string) {
      values.set(type, value);
    },
  };
}

scenario("valid typed project-file payload preserves project identity", () => {
  const payload = createProjectFileDragPayload({
    projectId: 42,
    path: "src/feature.ts",
  });
  assert.deepEqual(payload, {
    version: 1,
    kind: "project-file",
    projectId: 42,
    path: "src/feature.ts",
  });
});

scenario("path normalization is structural and case-sensitive", () => {
  assert.equal(normalizeDroppedRepositoryPath("./src\\Foo.ts"), "src/Foo.ts");
  assert.notEqual(
    normalizeDroppedRepositoryPath("src/Foo.ts"),
    normalizeDroppedRepositoryPath("src/foo.ts"),
  );
});

scenario("unsafe absolute and traversal paths are rejected", () => {
  for (const path of ["C:/private/file.ts", "/private/file.ts", "../file.ts", "src/../file.ts"]) {
    assert.equal(createProjectFileDragPayload({ projectId: 1, path }), null);
  }
});

scenario("malformed and oversized payloads are rejected", () => {
  assert.equal(parseContextForgeDragPayload("not-json"), null);
  assert.equal(parseContextForgeDragPayload("x".repeat(4097)), null);
  assert.equal(
    parseContextForgeDragPayload(
      JSON.stringify({
        version: 1,
        kind: "project-file",
        projectId: "7",
        path: "src/App.tsx",
      }),
    ),
    null,
  );
});

scenario("unknown kinds and unexpected fields are rejected", () => {
  assert.equal(
    parseContextForgeDragPayload(
      JSON.stringify({ version: 1, kind: "task-pack", projectId: 1, path: "a.ts" }),
    ),
    null,
  );
  assert.equal(
    parseContextForgeDragPayload(
      JSON.stringify({ version: 1, kind: "project-file", projectId: 1, path: "a.ts", command: "run" }),
    ),
    null,
  );
});

scenario("DataTransfer uses only the typed ContextForge MIME contract", () => {
  const transfer = fakeTransfer();
  const payload = createProjectFileDragPayload({ projectId: 7, path: "src/a.ts" });
  assert.ok(payload);
  assert.equal(writeContextForgeDragPayload(transfer as never, payload), true);
  assert.equal(transfer.effectAllowed, "copy");
  assert.deepEqual(transfer.types.sort(), [
    CONTEXTFORGE_DRAG_MIME,
    CONTEXTFORGE_PROJECT_FILE_DRAG_MIME,
  ].sort());
  assert.deepEqual(readContextForgeDragPayload(transfer as never), payload);
});

scenario("missing project-file marker prevents payload interpretation", () => {
  const transfer = fakeTransfer();
  transfer.setData(
    CONTEXTFORGE_DRAG_MIME,
    JSON.stringify({ version: 1, kind: "project-file", projectId: 1, path: "a.ts" }),
  );
  assert.equal(readContextForgeDragPayload(transfer as never), null);
});

scenario("typed and external file transfers are distinguished", () => {
  assert.equal(
    hasContextForgeProjectFileDrag({ types: [CONTEXTFORGE_PROJECT_FILE_DRAG_MIME] } as never),
    true,
  );
  assert.equal(hasExternalFileDrag({ types: ["Files"] } as never), true);
  assert.equal(hasExternalFileDrag({ types: ["text/html"] } as never), false);
});

const payload = createProjectFileDragPayload({ projectId: 3, path: "src/a.ts" });
assert.ok(payload);

scenario("known current-project file reuses the existing include path", () => {
  assert.deepEqual(
    classifyContextBasketDrop({
      payload,
      projectId: 3,
      selectedPaths: [],
      knownPaths: ["src/a.ts"],
    }),
    { status: "known-file", path: "src/a.ts" },
  );
});

scenario("already selected file is a duplicate, never a toggle", () => {
  assert.deepEqual(
    classifyContextBasketDrop({
      payload,
      projectId: 3,
      selectedPaths: ["src/a.ts"],
      knownPaths: ["src/a.ts"],
    }),
    { status: "already-selected", path: "src/a.ts" },
  );
});

scenario("cross-project payload cannot enter the basket", () => {
  assert.deepEqual(
    classifyContextBasketDrop({
      payload,
      projectId: 4,
      selectedPaths: [],
      knownPaths: ["src/a.ts"],
    }),
    { status: "wrong-project" },
  );
});

scenario("unknown current-project path requires server validation", () => {
  assert.deepEqual(
    classifyContextBasketDrop({
      payload,
      projectId: 3,
      selectedPaths: [],
      knownPaths: [],
    }),
    { status: "requires-validation", path: "src/a.ts" },
  );
});

process.stdout.write(`Drag and Drop smoke passed: ${scenarios} scenarios.\n`);
