import assert from "node:assert/strict";
import path from "node:path";

import type {
  ProjectInventory,
  ProjectInventoryFile,
} from "../scanner/projectInventoryScanner.js";
import { extractExplicitFileTargetMentions } from "./explicitFileMentions.js";
import { resolveGroundedSupportingContext } from "./supportingContextGrounding.js";

function file(
  pathValue: string,
  patch: Partial<ProjectInventoryFile> = {},
): ProjectInventoryFile {
  const name = pathValue.split("/").pop() ?? pathValue;
  return {
    path: pathValue,
    name,
    extension: path.extname(name).toLocaleLowerCase(),
    kind: "source",
    role: "unknown",
    imports: [],
    exports: [],
    symbols: [],
    textHints: [],
    sizeBytes: 2_000,
    depth: pathValue.split("/").length,
    canReadText: true,
    isLikelyGenerated: false,
    ...patch,
  };
}

function inventory(files: ProjectInventoryFile[]): ProjectInventory {
  return {
    rootPath: "C:/support-grounding-fixture",
    files,
    totalFiles: files.length,
    scannedFiles: files.length,
    truncated: false,
    notes: [],
  };
}

function backendFixture() {
  return inventory([
    file("server/src/routes/projects.ts", {
      role: "api-route",
      imports: ["../storage/index.js"],
      exports: ["projectsRouter"],
      symbols: ["projectsRouter", "getProjectById"],
      textHints: ["project", "projects", "storage"],
      semanticFacts: {
        declarations: ["projectsRouter", "getProjectById"],
        references: ["storage", "getProjectById", "listProjects"],
        assignments: [],
        objectProperties: ["id", "name", "lastScannedAt"],
        stateSymbols: [],
        translationKeys: [],
        translationEntries: [],
        routePaths: ["/:id"],
      },
      sizeBytes: 42_000,
    }),
    file("server/src/routes/taskPacks.ts", {
      role: "api-route",
      imports: ["../storage/index.js"],
      exports: ["taskPacksRouter"],
      symbols: ["taskPacksRouter", "getProjectById"],
      textHints: ["task", "pack", "project", "storage"],
      semanticFacts: {
        declarations: ["taskPacksRouter", "getProjectById"],
        references: ["storage", "projectId", "project"],
        assignments: [],
        objectProperties: [],
        stateSymbols: [],
        translationKeys: [],
        translationEntries: [],
        routePaths: [],
      },
      sizeBytes: 156_000,
    }),
    file("server/src/storage/index.ts", {
      role: "service",
      exports: ["storage"],
      symbols: ["storage", "getProjectById", "listProjects"],
      textHints: ["project", "storage"],
      semanticFacts: {
        declarations: ["storage"],
        references: ["getProjectById", "listProjects", "ProjectRecord"],
        assignments: [],
        objectProperties: [],
        stateSymbols: [],
        translationKeys: [],
        translationEntries: [],
        routePaths: [],
      },
    }),
    file("apps/desktop/renderer/src/api/client.ts", {
      role: "client-api",
      exports: ["api"],
      symbols: ["api", "getProject"],
      textHints: ["project", "storage"],
    }),
  ]);
}

function testExistingProjectStorageApi() {
  const results = resolveGroundedSupportingContext({
    rawTask:
      "Create server/src/routes/projectDiagnostics.ts and register it in server/src/index.ts. Reuse the existing project storage API. Backend only; do not modify renderer files.",
    inventory: backendFixture(),
    targetPaths: [
      "server/src/routes/projectDiagnostics.ts",
      "server/src/index.ts",
    ],
    maxFiles: 2,
  });

  assert.equal(results[0]?.file.path, "server/src/routes/projects.ts");
  assert.equal(
    results.some((candidate) => candidate.file.path.includes("renderer")),
    false,
  );
  assert.equal(
    results.some((candidate) => candidate.file.path === "server/src/routes/taskPacks.ts"),
    false,
    "a huge unrelated route must not displace the entity-specific provider example",
  );
}

function testNoExplicitReuseDirective() {
  const results = resolveGroundedSupportingContext({
    rawTask:
      "Create server/src/routes/projectDiagnostics.ts and register it in server/src/index.ts.",
    inventory: backendFixture(),
    targetPaths: ["server/src/routes/projectDiagnostics.ts"],
  });
  assert.deepEqual(results, []);
}

function testRussianReuseDirective() {
  const results = resolveGroundedSupportingContext({
    rawTask:
      "Создай server/src/routes/projectDiagnostics.ts. Используй существующий API хранилища проектов. Только backend, renderer не меняй.",
    inventory: backendFixture(),
    targetPaths: ["server/src/routes/projectDiagnostics.ts"],
    maxFiles: 1,
  });
  assert.equal(results[0]?.file.path, "server/src/routes/projects.ts");
}

function testUkrainianReuseDirective() {
  const results = resolveGroundedSupportingContext({
    rawTask:
      "Створи server/src/routes/projectDiagnostics.ts. Використай існуючий API сховища проєктів. Лише backend, renderer не змінюй.",
    inventory: inventory([
      file("server/src/routes/projects.ts", {
        role: "api-route",
        imports: ["../storage/index.js"],
        exports: ["projectsRouter"],
        textHints: ["проєкти", "сховище"],
        semanticFacts: {
          declarations: ["projectsRouter"],
          references: ["storage", "getProjectById"],
          assignments: [],
          objectProperties: [],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
    ]),
    targetPaths: ["server/src/routes/projectDiagnostics.ts"],
    maxFiles: 1,
  });
  assert.equal(results[0]?.file.path, "server/src/routes/projects.ts");
}

function testUiExistingClientApi() {
  const results = resolveGroundedSupportingContext({
    rawTask:
      "Create src/pages/StatusPage.tsx. Use the existing status API client. UI only; do not change server files.",
    inventory: inventory([
      file("src/api/statusClient.ts", {
        role: "client-api",
        exports: ["getStatus"],
        symbols: ["getStatus"],
        textHints: ["status", "api", "client"],
      }),
      file("src/pages/OtherStatusPage.tsx", {
        role: "page",
        imports: ["../api/statusClient.js"],
        symbols: ["OtherStatusPage", "getStatus"],
        textHints: ["status", "api", "client"],
      }),
      file("server/src/routes/status.ts", {
        role: "api-route",
        exports: ["statusRouter"],
        textHints: ["status", "api"],
      }),
    ]),
    targetPaths: ["src/pages/StatusPage.tsx"],
    maxFiles: 2,
  });
  assert.deepEqual(results.map((candidate) => candidate.file.path), [
    "src/api/statusClient.ts",
  ]);
}

function testUnrelatedProviderIsNotSelected() {
  const results = resolveGroundedSupportingContext({
    rawTask:
      "Create server/src/routes/projectDiagnostics.ts. Reuse the existing project storage API.",
    inventory: inventory([
      file("server/src/routes/users.ts", {
        role: "api-route",
        imports: ["../storage/index.js"],
        textHints: ["users", "storage"],
      }),
    ]),
    targetPaths: ["server/src/routes/projectDiagnostics.ts"],
  });
  assert.deepEqual(results, []);
}

function testExplicitProviderPathRemainsReferenceOnly() {
  const provider = "server/src/routes/projects.ts";
  const rawTask =
    "Create server/src/routes/projectDiagnostics.ts and register it in server/src/index.ts. " +
    `Reuse the existing project storage API demonstrated in ${provider}. ` +
    "Use that file only as reference and do not modify it. Backend only; do not modify renderer files.";

  assert.deepEqual(extractExplicitFileTargetMentions(rawTask), [
    "server/src/routes/projectDiagnostics.ts",
    "server/src/index.ts",
  ]);

  const results = resolveGroundedSupportingContext({
    rawTask,
    inventory: backendFixture(),
    targetPaths: [
      "server/src/routes/projectDiagnostics.ts",
      "server/src/index.ts",
    ],
    maxFiles: 1,
  });

  assert.equal(results[0]?.file.path, provider);
}

function testMultilingualReferenceOnlyPathsAreNotEditTargets() {
  const expectedTargets = [
    "server/src/routes/projectDiagnostics.ts",
    "server/src/index.ts",
  ];
  const tasks = [
    "Создай server/src/routes/projectDiagnostics.ts и зарегистрируй его в server/src/index.ts. Используй server/src/routes/projects.ts только как пример и не меняй этот файл.",
    "Створи server/src/routes/projectDiagnostics.ts і зареєструй його у server/src/index.ts. Використай server/src/routes/projects.ts лише як приклад і не змінюй цей файл.",
  ];

  for (const rawTask of tasks) {
    assert.deepEqual(extractExplicitFileTargetMentions(rawTask), expectedTargets);
  }
}

function main() {
  testExistingProjectStorageApi();
  testNoExplicitReuseDirective();
  testRussianReuseDirective();
  testUkrainianReuseDirective();
  testUiExistingClientApi();
  testUnrelatedProviderIsNotSelected();
  testExplicitProviderPathRemainsReferenceOnly();
  testMultilingualReferenceOnlyPathsAreNotEditTargets();
  console.log("supporting context grounding smoke passed: 9 scenarios");
}

main();
