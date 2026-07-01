import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { scanProjectInventory, type ProjectInventory, type ProjectInventoryFile } from "../scanner/projectInventoryScanner.js";
import { evaluateContextSelectionQuality } from "../selection/contextQuality.js";
import type { AppSettings } from "../settings/settingsService.js";
import type { TaskIntentAnalysis } from "./taskIntentAnalyzer.js";
import { selectTaskFiles } from "./taskFileSelector.js";

const testSettings: AppSettings = {
  ollamaUrl: "http://127.0.0.1:11434",
  generationMode: "template",
  defaultTargetTool: "codex",
  defaultTaskType: "general",
  defaultOllamaModel: null,
  language: "en",
  composerFileLimits: {
    default: 8,
    ui: 7,
    backend: 8,
    fullstack: 10,
    build: 7,
    bugfix: 7,
    refactor: 8,
    docs: 6,
    tests: 7
  },
  contextQualityMode: "balanced",
  sidebarShowDescriptions: false
};

function sourceFile(pathValue: string, patch: Partial<ProjectInventoryFile> = {}): ProjectInventoryFile {
  const name = pathValue.split("/").pop() ?? pathValue;
  return {
    path: pathValue,
    name,
    extension: path.extname(name).toLowerCase(),
    kind: "source",
    role: "component",
    imports: [],
    exports: [],
    symbols: [],
    textHints: [],
    sizeBytes: 1200,
    depth: pathValue.split("/").length,
    canReadText: true,
    isLikelyGenerated: false,
    ...patch
  };
}

function inventory(files: ProjectInventoryFile[]): ProjectInventory {
  return {
    rootPath: "C:/fixture",
    files,
    totalFiles: files.length,
    scannedFiles: files.length,
    truncated: false,
    notes: []
  };
}

async function select(rawTask: string, files: ProjectInventoryFile[], taskType = "ui") {
  return selectTaskFiles({
    rawTask,
    taskType,
    targetTool: "codex",
    inventory: inventory(files),
    settings: testSettings
  });
}

function structuredIntent(overrides: Partial<TaskIntentAnalysis> = {}): TaskIntentAnalysis {
  return {
    taskArea: "ui",
    intentTags: [],
    domainTerms: [],
    mentionedEntities: [],
    fileRoleHints: [],
    recommendedSearchTerms: [],
    riskLevel: "medium",
    confidence: 0.82,
    notes: ["Synthetic structured intent for selector smoke coverage."],
    structuredIntent: {
      schemaVersion: 1,
      primaryTargets: [],
      positiveActions: [],
      protectedScopes: [],
      allowedEditScope: "target_with_supporting_context",
      needsStyles: null,
      needsBackend: null,
      ambiguities: [],
      modelNotes: []
    },
    source: "ollama",
    durationMs: 1,
    ...overrides
  };
}

async function testSemanticPageTarget() {
  const result = await select(
    "Страница с реквизитами выглядит слишком формально. Сделай понятнее, но контакты и юридические страницы не трогать.",
    [
      sourceFile("src/app/(site)/page.tsx", {
        role: "page",
        routePath: "/",
        textHints: ["главная", "платформа"]
      }),
      sourceFile("src/app/(site)/requisites/page.tsx", {
        role: "page",
        routePath: "/requisites",
        imports: ["./RequisitesDetails"],
        exports: ["metadata"],
        symbols: ["RequisitesPage", "metadata"],
        textHints: ["реквизиты", "банковские", "компании"],
        contentPreview: "export const metadata = { title: 'Реквизиты', description: 'Реквизиты компании' }; <h1>Реквизиты</h1>"
      }),
      sourceFile("src/app/(site)/requisites/RequisitesDetails.tsx", {
        symbols: ["RequisitesDetails"],
        textHints: ["реквизиты", "банковские", "детали"]
      }),
      sourceFile("src/app/(site)/contacts/page.tsx", {
        role: "page",
        routePath: "/contacts",
        textHints: ["контакты", "телефон"]
      }),
      sourceFile("src/app/(site)/legal/page.tsx", {
        role: "page",
        routePath: "/legal",
        textHints: ["юридические", "политика"]
      }),
      sourceFile("src/components/ui/Button.tsx", {
        role: "ui-component",
        textHints: ["button", "кнопка"]
      })
    ]
  );

  assert.equal(result.selectedFiles[0]?.path, "src/app/(site)/requisites/page.tsx");
  assert.equal(result.selectedFiles.find((file) => file.path.endsWith("RequisitesDetails.tsx"))?.usage, "inspect-and-edit");
  assert.equal(result.selectedFiles.some((file) => file.path.includes("/contacts/")), false);
  assert.equal(result.selectedFiles.some((file) => file.path.includes("/legal/")), false);
}

async function testHeaderTaskDoesNotBecomeRootPageTask() {
  const result = await select(
    "Нужно исправить Header: при русском языке текст налазит на кнопки.",
    [
      sourceFile("src/components/Header.tsx", {
        role: "component",
        symbols: ["Header"],
        textHints: ["header", "nav", "navigation", "language", "русский"]
      }),
      sourceFile("src/styles/global.css", {
        kind: "style",
        role: "style",
        textHints: ["topbar", "header", "nav"]
      }),
      sourceFile("src/app/page.tsx", {
        role: "page",
        routePath: "/",
        textHints: ["главная", "landing"]
      })
    ]
  );

  assert.equal(result.selectedFiles[0]?.path, "src/components/Header.tsx");
  assert.equal(result.selectedFiles.some((file) => file.path === "src/app/page.tsx" && file.usage === "inspect-and-edit"), false);
}

async function testExplicitRussianHeaderFileDoesNotBlockReview() {
  const files = [
    sourceFile("src/components/Header.tsx", {
      role: "component",
      symbols: ["Header"],
      textHints: ["header", "nav", "navigation", "language", "russian"]
    }),
    sourceFile("src/styles/global.css", {
      kind: "style",
      role: "style",
      textHints: ["topbar", "header", "nav"]
    }),
    sourceFile("src/components/Button.tsx", {
      role: "ui-component",
      textHints: ["button"]
    }),
    sourceFile("src/app/page.tsx", {
      role: "page",
      routePath: "/",
      textHints: ["home", "landing"]
    })
  ];
  const projectInventory = inventory(files);
  const rawTask = "В файле src/components/Header.tsx исправить навигацию и не менять остальные файлы.";
  const result = await selectTaskFiles({
    rawTask,
    taskType: "ui",
    targetTool: "codex",
    inventory: projectInventory,
    settings: testSettings
  });
  const quality = evaluateContextSelectionQuality({
    rawTask,
    requestedTaskType: "ui",
    effectiveTaskArea: result.effectiveTaskArea,
    inventory: projectInventory,
    fileSelection: result,
    manualSelectionConfirmed: false,
    contextQualityMode: "balanced"
  });

  assert.deepEqual(result.selectedFiles.map((file) => file.path), ["src/components/Header.tsx"]);
  assert.equal(result.selectedFiles[0]?.usage, "inspect-and-edit");
  assert.notEqual(quality.status, "blocked");
  assert.equal(quality.requiredManualReview, false);
}

async function testStructuredIntentCanSeedExplicitTarget() {
  const files = [
    sourceFile("src/components/Header.tsx", {
      role: "component",
      symbols: ["Header"],
      textHints: ["header", "navigation"]
    }),
    sourceFile("src/components/Footer.tsx", {
      role: "component",
      symbols: ["Footer"],
      textHints: ["footer"]
    })
  ];
  const result = await selectTaskFiles({
    rawTask: "Аккуратно почини Header, остальное не трогай.",
    taskType: "ui",
    targetTool: "codex",
    inventory: inventory(files),
    settings: testSettings,
    taskIntent: structuredIntent({
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [{
          kind: "explicit_file",
          value: "src/components/Header.tsx",
          path: "src/components/Header.tsx",
          confidence: 0.97,
          evidence: "Model resolved the user's selected UI area to the header component."
        }],
        positiveActions: ["fix selected UI area"],
        protectedScopes: ["other files"],
        allowedEditScope: "explicit_targets_only",
        needsStyles: null,
        needsBackend: false,
        ambiguities: [],
        modelNotes: []
      }
    })
  });

  assert.deepEqual(result.selectedFiles.map((file) => file.path), ["src/components/Header.tsx"]);
  assert.equal(result.selectedFiles[0]?.usage, "inspect-and-edit");
}

async function testStructuredIntentCanSeedSemanticPageTarget() {
  const result = await selectTaskFiles({
    rawTask: "Этот раздел звучит слишком официально. Сделай понятнее для клиента.",
    taskType: "ui",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/app/(site)/requisites/page.tsx", {
        role: "page",
        routePath: "/requisites",
        imports: ["./RequisitesDetails"],
        symbols: ["RequisitesPage"],
        textHints: ["реквизиты", "банковские", "company details"],
        contentPreview: "export const metadata = { title: 'Реквизиты' }; <h1>Реквизиты</h1>"
      }),
      sourceFile("src/app/(site)/contacts/page.tsx", {
        role: "page",
        routePath: "/contacts",
        textHints: ["контакты"]
      }),
      sourceFile("src/components/ui/Button.tsx", {
        role: "ui-component",
        textHints: ["button"]
      })
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      domainTerms: ["requisites"],
      recommendedSearchTerms: ["requisites"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [{
          kind: "page",
          value: "requisites",
          routePath: "/requisites",
          confidence: 0.91,
          evidence: "Model mapped the described business section to the requisites page."
        }],
        positiveActions: ["make the page copy clearer"],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: []
      }
    })
  });

  assert.equal(result.selectedFiles[0]?.path, "src/app/(site)/requisites/page.tsx");
  assert.equal(result.selectedFiles.some((file) => file.path.includes("/contacts/")), false);
}

async function testProtectedApiTerms() {
  const result = await select(
    "Нужно в src/components/UsersTable.js улучшить внешний вид формы. Логику загрузки, удаления и API-запросы не менять.",
    [
      sourceFile("src/components/UsersTable.js", {
        symbols: ["UsersTable"],
        textHints: ["users", "table", "form"]
      }),
      sourceFile("src/api/api.js", {
        role: "client-api",
        symbols: ["loadUsers", "deleteUser"],
        textHints: ["api", "request", "users"]
      })
    ]
  );

  assert.equal(result.selectedFiles[0]?.path, "src/components/UsersTable.js");
  assert.equal(result.selectedFiles.some((file) => file.path === "src/api/api.js" && file.usage === "inspect-and-edit"), false);
}

async function testGeneralHeaderTaskWithBackendConstraintStaysUi() {
  const rawTask = "Почини штуку, где после смены языка всё едет вправо. Я не знаю файл, но это где верхнее меню, переключатель темы и кнопка аккаунта. Бэк, авторизацию и API не трогай.";
  const result = await selectTaskFiles({
    rawTask,
    taskType: "general",
    targetTool: "claude",
    inventory: inventory([
      sourceFile("src/components/Header.tsx", {
        role: "component",
        symbols: ["Header"],
        textHints: ["header", "topbar", "navigation", "language", "theme", "account", "menu"]
      }),
      sourceFile("src/styles/global.css", {
        kind: "style",
        role: "style",
        textHints: ["topbar", "header", "navigation", "theme"]
      }),
      sourceFile("src/i18n/translations.ts", {
        role: "unknown",
        textHints: ["language", "locale", "translations", "russian"]
      }),
      sourceFile("server/index.mjs", {
        role: "server-entry",
        textHints: ["server", "api", "auth"]
      }),
      sourceFile("server/schema.sql", {
        kind: "data",
        role: "db-schema",
        textHints: ["database", "auth", "sessions"]
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        textHints: ["api", "fetch", "auth"]
      }),
      sourceFile("src/contexts/AuthContext.tsx", {
        role: "store",
        textHints: ["auth", "session", "account"]
      })
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "backend",
      confidence: 0.8,
      intentTags: ["auth", "api"],
      fileRoleHints: ["api", "service"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["fix header layout after language switch"],
        protectedScopes: ["backend/api", "auth"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: ["Synthetic regression: model misclassified a UI task as backend."]
      }
    })
  });

  assert.equal(result.effectiveTaskArea, "ui");
  assert.equal(result.selectedFiles[0]?.path, "src/components/Header.tsx");
  assert.equal(result.notes.includes("Selector safety profile: ui-specific-target-review-v5."), true);
  assert.equal(result.selectedFiles.some((file) => file.path.startsWith("server/")), false);
  assert.equal(result.selectedFiles.some((file) => file.path === "src/api/client.ts"), false);
  assert.equal(result.selectedFiles.some((file) => file.path === "src/contexts/AuthContext.tsx" && file.usage === "inspect-and-edit"), false);
}

async function testUnsupportedStructuredHeaderTargetIsIgnored() {
  const result = await selectTaskFiles({
    rawTask: "Улучши форму добавления пользователя, чтобы поля были понятнее. Логику загрузки, удаления и API-запросы не менять.",
    taskType: "ui",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/components/Header.tsx", {
        role: "component",
        symbols: ["Header"],
        textHints: ["header", "navigation", "topbar"]
      }),
      sourceFile("src/pages/AuthPage.tsx", {
        role: "page",
        symbols: ["AuthPage"],
        textHints: ["auth", "login", "form", "email"]
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        textHints: ["api", "request"]
      })
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [{
          kind: "explicit_file",
          value: "src/components/Header.tsx",
          path: "src/components/Header.tsx",
          confidence: 0.97,
          evidence: "Leaked schema example; the user did not mention this file."
        }],
        positiveActions: ["improve user add form"],
        protectedScopes: ["backend/api"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: ["No exact add-user form file exists in this fixture."],
        modelNotes: []
      }
    })
  });

  assert.deepEqual(result.selectedFiles.map((file) => file.path), []);
  assert.equal(result.notes.some((note) => note.includes("specific UI object")), true);
}

async function testHallucinatedHeaderHintsDoNotOverrideSpecificFormTask() {
  const result = await selectTaskFiles({
    rawTask: "Improve the add user form. Do not change API requests or loading.",
    taskType: "general",
    targetTool: "claude",
    inventory: inventory([
      sourceFile("src/components/Header.tsx", {
        role: "component",
        symbols: ["Header"],
        textHints: ["header", "navigation", "topbar", "language"]
      }),
      sourceFile("src/styles/global.css", {
        kind: "style",
        role: "style",
        textHints: ["topbar", "header", "navigation", "theme"]
      }),
      sourceFile("src/components/Button.tsx", {
        role: "component",
        symbols: ["Button"],
        textHints: ["button", "control"]
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        textHints: ["api", "request", "loading"]
      })
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      intentTags: ["navigation-ui"],
      domainTerms: ["form", "user", "api", "loading"],
      fileRoleHints: ["component", "style"],
      recommendedSearchTerms: ["header", "topbar", "navigation"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["fix header navigation after language switch"],
        protectedScopes: ["api requests", "loading"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: ["The inventory fixture has no add-user form file."],
        modelNotes: ["Synthetic regression: model hallucinated header terms for a form task."]
      }
    })
  });

  assert.deepEqual(result.selectedFiles.map((file) => file.path), []);
  assert.equal(result.notes.includes("Selector safety profile: ui-specific-target-review-v5."), true);
  assert.equal(result.notes.some((note) => note.includes("specific UI object")), true);
  assert.equal(result.notes.some((note) => note.includes("Header/navigation surface target detected")), false);
}

async function testAdminPageFormWithProtectedApiStaysPageScoped() {
  const result = await selectTaskFiles({
    rawTask: "Add a user creation form to the admin page. Do not change API requests or loading.",
    taskType: "general",
    targetTool: "claude",
    inventory: inventory([
      sourceFile("src/pages/AdminPage.tsx", {
        role: "page",
        routePath: "/admin",
        imports: ["../api/client", "../hooks/useLocale"],
        symbols: ["AdminPage"],
        textHints: ["admin", "administrator", "dashboard", "users"]
      }),
      sourceFile("src/pages/AuthCallbackPage.tsx", {
        role: "page",
        routePath: "/auth/callback",
        imports: ["../api/client", "../contexts/AuthContext"],
        symbols: ["AuthCallbackPage"],
        textHints: ["auth", "callback", "session", "user"]
      }),
      sourceFile("src/hooks/useLocale.ts", {
        role: "hook",
        symbols: ["useLocale"],
        textHints: ["locale", "translation"]
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        symbols: ["api", "adminSummary", "syncReleases"],
        textHints: ["api", "request", "loading", "admin"]
      }),
      sourceFile("src/contexts/AuthContext.tsx", {
        role: "store",
        symbols: ["AuthProvider", "useAuth"],
        textHints: ["auth", "session", "user"]
      })
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      intentTags: ["backend-flow"],
      domainTerms: ["add", "admin", "page", "form", "user", "api", "loading"],
      fileRoleHints: ["api", "route", "service"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["add user creation form to admin page"],
        protectedScopes: ["api requests", "loading"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: ["Synthetic regression: API and auth files must not become editable page support."]
      }
    })
  });

  assert.deepEqual(
    result.selectedFiles.map((file) => [file.path, file.usage]),
    [
      ["src/pages/AdminPage.tsx", "inspect-and-edit"],
      ["src/hooks/useLocale.ts", "inspect-only"]
    ]
  );
  assert.equal(result.selectedFiles.some((file) => file.path === "src/pages/AuthCallbackPage.tsx"), false);
  assert.equal(result.selectedFiles.some((file) => file.path === "src/api/client.ts"), false);
  assert.equal(result.selectedFiles.some((file) => file.path === "src/contexts/AuthContext.tsx"), false);
}

async function testEnvFilesAreNotReadIntoInventory() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contextforge-selector-"));
  await fs.writeFile(path.join(root, ".env"), "SESSION_SECRET=super-secret-value\nDATABASE_URL=postgresql://user:pass@localhost/db\n");
  await fs.writeFile(path.join(root, ".env.example"), "SESSION_SECRET=example\nDATABASE_URL=postgresql://user:pass@localhost/db\n");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "app", "page.tsx"), "export const metadata = { title: 'Home' };\nexport default function Page(){ return <h1>Home</h1>; }\n");

  const scanned = await scanProjectInventory(root);
  const envFile = scanned.files.find((file) => file.path === ".env");
  const envExampleFile = scanned.files.find((file) => file.path === ".env.example");

  assert.equal(envFile?.canReadText, false);
  assert.equal(envFile?.contentPreview, undefined);
  assert.equal(envExampleFile?.canReadText, true);
  assert.equal(envExampleFile?.contentPreview?.includes("super-secret-value"), false);
}

async function main() {
  await testSemanticPageTarget();
  await testHeaderTaskDoesNotBecomeRootPageTask();
  await testExplicitRussianHeaderFileDoesNotBlockReview();
  await testStructuredIntentCanSeedExplicitTarget();
  await testStructuredIntentCanSeedSemanticPageTarget();
  await testProtectedApiTerms();
  await testGeneralHeaderTaskWithBackendConstraintStaysUi();
  await testUnsupportedStructuredHeaderTargetIsIgnored();
  await testHallucinatedHeaderHintsDoNotOverrideSpecificFormTask();
  await testAdminPageFormWithProtectedApiStaysPageScoped();
  await testEnvFilesAreNotReadIntoInventory();
  console.log("taskFileSelector smoke tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
