import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  scanProjectInventory,
  type ProjectInventory,
  type ProjectInventoryFile,
} from "../scanner/projectInventoryScanner.js";
import { evaluateContextSelectionQuality } from "../selection/contextQuality.js";
import { buildProjectSemanticGraph } from "../selection/projectSemanticGraph.js";
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
    tests: 7,
  },
  contextQualityMode: "balanced",
  sidebarShowDescriptions: false,
};

function sourceFile(
  pathValue: string,
  patch: Partial<ProjectInventoryFile> = {},
): ProjectInventoryFile {
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
    ...patch,
  };
}

function inventory(files: ProjectInventoryFile[]): ProjectInventory {
  return {
    rootPath: "C:/fixture",
    files,
    totalFiles: files.length,
    scannedFiles: files.length,
    truncated: false,
    notes: [],
  };
}

async function select(
  rawTask: string,
  files: ProjectInventoryFile[],
  taskType = "ui",
) {
  return selectTaskFiles({
    rawTask,
    taskType,
    targetTool: "codex",
    inventory: inventory(files),
    settings: testSettings,
  });
}

function structuredIntent(
  overrides: Partial<TaskIntentAnalysis> = {},
): TaskIntentAnalysis {
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
      modelNotes: [],
    },
    source: "ollama",
    durationMs: 1,
    ...overrides,
  };
}

async function testSemanticPageTarget() {
  const result = await select(
    "Страница с реквизитами выглядит слишком формально. Сделай понятнее, но контакты и юридические страницы не трогать.",
    [
      sourceFile("src/app/(site)/page.tsx", {
        role: "page",
        routePath: "/",
        textHints: ["главная", "платформа"],
      }),
      sourceFile("src/app/(site)/requisites/page.tsx", {
        role: "page",
        routePath: "/requisites",
        imports: ["./RequisitesDetails"],
        exports: ["metadata"],
        symbols: ["RequisitesPage", "metadata"],
        textHints: ["реквизиты", "банковские", "компании"],
        contentPreview:
          "export const metadata = { title: 'Реквизиты', description: 'Реквизиты компании' }; <h1>Реквизиты</h1>",
      }),
      sourceFile("src/app/(site)/requisites/RequisitesDetails.tsx", {
        symbols: ["RequisitesDetails"],
        textHints: ["реквизиты", "банковские", "детали"],
      }),
      sourceFile("src/app/(site)/contacts/page.tsx", {
        role: "page",
        routePath: "/contacts",
        textHints: ["контакты", "телефон"],
      }),
      sourceFile("src/app/(site)/legal/page.tsx", {
        role: "page",
        routePath: "/legal",
        textHints: ["юридические", "политика"],
      }),
      sourceFile("src/components/ui/Button.tsx", {
        role: "ui-component",
        textHints: ["button", "кнопка"],
      }),
    ],
  );

  assert.equal(
    result.selectedFiles[0]?.path,
    "src/app/(site)/requisites/page.tsx",
  );
  assert.equal(
    result.selectedFiles.find((file) =>
      file.path.endsWith("RequisitesDetails.tsx"),
    )?.usage,
    "inspect-and-edit",
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path.includes("/contacts/")),
    false,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path.includes("/legal/")),
    false,
  );
}

async function testHeaderTaskDoesNotBecomeRootPageTask() {
  const result = await select(
    "Нужно исправить Header: при русском языке текст налазит на кнопки.",
    [
      sourceFile("src/components/Header.tsx", {
        role: "component",
        symbols: ["Header"],
        textHints: ["header", "nav", "navigation", "language", "русский"],
      }),
      sourceFile("src/styles/global.css", {
        kind: "style",
        role: "style",
        textHints: ["topbar", "header", "nav"],
      }),
      sourceFile("src/app/page.tsx", {
        role: "page",
        routePath: "/",
        textHints: ["главная", "landing"],
      }),
    ],
  );

  assert.equal(result.selectedFiles[0]?.path, "src/components/Header.tsx");
  assert.equal(
    result.selectedFiles.some(
      (file) =>
        file.path === "src/app/page.tsx" && file.usage === "inspect-and-edit",
    ),
    false,
  );
}

async function testSemanticPageTargetUnicode() {
  const result = await select(
    "Страница с реквизитами выглядит слишком формально. Сделай понятнее, но контакты и юридические страницы не трогать.",
    [
      sourceFile("src/app/(site)/page.tsx", {
        role: "page",
        routePath: "/",
        textHints: ["главная", "платформа"],
      }),
      sourceFile("src/app/(site)/requisites/page.tsx", {
        role: "page",
        routePath: "/requisites",
        imports: ["./RequisitesDetails"],
        exports: ["metadata"],
        symbols: ["RequisitesPage", "metadata"],
        textHints: ["реквизиты", "банковские", "компании"],
        contentPreview:
          "export const metadata = { title: 'Реквизиты', description: 'Реквизиты компании' }; <h1>Реквизиты</h1>",
      }),
      sourceFile("src/app/(site)/requisites/RequisitesDetails.tsx", {
        symbols: ["RequisitesDetails"],
        textHints: ["реквизиты", "банковские", "детали"],
      }),
      sourceFile("src/app/(site)/contacts/page.tsx", {
        role: "page",
        routePath: "/contacts",
        textHints: ["контакты", "телефон"],
      }),
      sourceFile("src/app/(site)/legal/page.tsx", {
        role: "page",
        routePath: "/legal",
        textHints: ["юридические", "политика"],
      }),
      sourceFile("src/components/ui/Button.tsx", {
        role: "ui-component",
        textHints: ["button", "кнопка"],
      }),
    ],
  );

  assert.equal(
    result.selectedFiles[0]?.path,
    "src/app/(site)/requisites/page.tsx",
  );
  assert.equal(
    result.selectedFiles.find((file) =>
      file.path.endsWith("RequisitesDetails.tsx"),
    )?.usage,
    "inspect-and-edit",
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path.includes("/contacts/")),
    false,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path.includes("/legal/")),
    false,
  );
}

async function testExplicitRussianHeaderFileDoesNotBlockReview() {
  const files = [
    sourceFile("src/components/Header.tsx", {
      role: "component",
      symbols: ["Header"],
      textHints: ["header", "nav", "navigation", "language", "russian"],
    }),
    sourceFile("src/styles/global.css", {
      kind: "style",
      role: "style",
      textHints: ["topbar", "header", "nav"],
    }),
    sourceFile("src/components/Button.tsx", {
      role: "ui-component",
      textHints: ["button"],
    }),
    sourceFile("src/app/page.tsx", {
      role: "page",
      routePath: "/",
      textHints: ["home", "landing"],
    }),
  ];
  const projectInventory = inventory(files);
  const rawTask =
    "В файле src/components/Header.tsx исправить навигацию и не менять остальные файлы.";
  const result = await selectTaskFiles({
    rawTask,
    taskType: "ui",
    targetTool: "codex",
    inventory: projectInventory,
    settings: testSettings,
  });
  const quality = evaluateContextSelectionQuality({
    rawTask,
    requestedTaskType: "ui",
    effectiveTaskArea: result.effectiveTaskArea,
    inventory: projectInventory,
    fileSelection: result,
    manualSelectionConfirmed: false,
    contextQualityMode: "balanced",
  });

  assert.deepEqual(
    result.selectedFiles.map((file) => file.path),
    ["src/components/Header.tsx"],
  );
  assert.equal(result.selectedFiles[0]?.usage, "inspect-and-edit");
  assert.notEqual(quality.status, "blocked");
  assert.equal(quality.requiredManualReview, false);
}

async function testStructuredIntentCanSeedExplicitTarget() {
  const files = [
    sourceFile("src/components/Header.tsx", {
      role: "component",
      symbols: ["Header"],
      textHints: ["header", "navigation"],
    }),
    sourceFile("src/components/Footer.tsx", {
      role: "component",
      symbols: ["Footer"],
      textHints: ["footer"],
    }),
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
        primaryTargets: [
          {
            kind: "explicit_file",
            value: "src/components/Header.tsx",
            path: "src/components/Header.tsx",
            confidence: 0.97,
            evidence:
              "Model resolved the user's selected UI area to the header component.",
          },
        ],
        positiveActions: ["fix selected UI area"],
        protectedScopes: ["other files"],
        allowedEditScope: "explicit_targets_only",
        needsStyles: null,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.deepEqual(
    result.selectedFiles.map((file) => file.path),
    ["src/components/Header.tsx"],
  );
  assert.equal(result.selectedFiles[0]?.usage, "inspect-and-edit");
}

async function testStructuredIntentCanSeedSemanticPageTarget() {
  const result = await selectTaskFiles({
    rawTask:
      "Этот раздел звучит слишком официально. Сделай понятнее для клиента.",
    taskType: "ui",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/app/(site)/requisites/page.tsx", {
        role: "page",
        routePath: "/requisites",
        imports: ["./RequisitesDetails"],
        symbols: ["RequisitesPage"],
        textHints: ["реквизиты", "банковские", "company details"],
        contentPreview:
          "export const metadata = { title: 'Реквизиты' }; <h1>Реквизиты</h1>",
      }),
      sourceFile("src/app/(site)/contacts/page.tsx", {
        role: "page",
        routePath: "/contacts",
        textHints: ["контакты"],
      }),
      sourceFile("src/components/ui/Button.tsx", {
        role: "ui-component",
        textHints: ["button"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      domainTerms: ["requisites"],
      recommendedSearchTerms: ["requisites"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [
          {
            kind: "page",
            value: "requisites",
            routePath: "/requisites",
            confidence: 0.91,
            evidence:
              "Model mapped the described business section to the requisites page.",
          },
        ],
        positiveActions: ["make the page copy clearer"],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(
    result.selectedFiles[0]?.path,
    "src/app/(site)/requisites/page.tsx",
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path.includes("/contacts/")),
    false,
  );
}

async function testProtectedApiTerms() {
  const result = await select(
    "Нужно в src/components/UsersTable.js улучшить внешний вид формы. Логику загрузки, удаления и API-запросы не менять.",
    [
      sourceFile("src/components/UsersTable.js", {
        symbols: ["UsersTable"],
        textHints: ["users", "table", "form"],
      }),
      sourceFile("src/api/api.js", {
        role: "client-api",
        symbols: ["loadUsers", "deleteUser"],
        textHints: ["api", "request", "users"],
      }),
    ],
  );

  assert.equal(result.selectedFiles[0]?.path, "src/components/UsersTable.js");
  assert.equal(
    result.selectedFiles.some(
      (file) =>
        file.path === "src/api/api.js" && file.usage === "inspect-and-edit",
    ),
    false,
  );
}

async function testGeneralHeaderTaskWithBackendConstraintStaysUi() {
  const rawTask =
    "Почини штуку, где после смены языка всё едет вправо. Я не знаю файл, но это где верхнее меню, переключатель темы и кнопка аккаунта. Бэк, авторизацию и API не трогай.";
  const result = await selectTaskFiles({
    rawTask,
    taskType: "general",
    targetTool: "claude",
    inventory: inventory([
      sourceFile("src/components/Header.tsx", {
        role: "component",
        symbols: ["Header"],
        textHints: [
          "header",
          "topbar",
          "navigation",
          "language",
          "theme",
          "account",
          "menu",
        ],
      }),
      sourceFile("src/styles/global.css", {
        kind: "style",
        role: "style",
        textHints: ["topbar", "header", "navigation", "theme"],
      }),
      sourceFile("src/i18n/translations.ts", {
        role: "unknown",
        textHints: ["language", "locale", "translations", "russian"],
      }),
      sourceFile("server/index.mjs", {
        role: "server-entry",
        textHints: ["server", "api", "auth"],
      }),
      sourceFile("server/schema.sql", {
        kind: "data",
        role: "db-schema",
        textHints: ["database", "auth", "sessions"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        textHints: ["api", "fetch", "auth"],
      }),
      sourceFile("src/contexts/AuthContext.tsx", {
        role: "store",
        textHints: ["auth", "session", "account"],
      }),
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
        modelNotes: [
          "Synthetic regression: model misclassified a UI task as backend.",
        ],
      },
    }),
  });

  assert.equal(result.effectiveTaskArea, "ui");
  assert.equal(result.selectedFiles[0]?.path, "src/components/Header.tsx");
  assert.equal(
    result.notes.includes(
      "Selector safety profile: ui-specific-target-review-v5.",
    ),
    true,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path.startsWith("server/")),
    false,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path === "src/api/client.ts"),
    false,
  );
  assert.equal(
    result.selectedFiles.some(
      (file) =>
        file.path === "src/contexts/AuthContext.tsx" &&
        file.usage === "inspect-and-edit",
    ),
    false,
  );
}

async function testStructuredHeaderTargetCannotBeDisplacedByPageFallback() {
  const result = await selectTaskFiles({
    rawTask:
      "\u0418\u0441\u043f\u0440\u0430\u0432\u044c Header, \u043d\u0430 \u0440\u0443\u0441\u0441\u043a\u043e\u043c \u0442\u0435\u043a\u0441\u0442 \u043d\u0430\u043b\u0435\u0437\u0430\u0435\u0442 \u043d\u0430 \u043a\u043d\u043e\u043f\u043a\u0438.",
    taskType: "general",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/components/Header.tsx", {
        role: "component",
        imports: ["../contexts/AuthContext"],
        exports: ["Header"],
        symbols: ["Header"],
        textHints: ["header", "nav", "menu", "locale", "button"],
      }),
      sourceFile("src/styles/global.css", {
        kind: "style",
        role: "style",
        textHints: ["topbar", "header", "navigation"],
      }),
      sourceFile("src/pages/OnboardingPage.tsx", {
        role: "page",
        imports: [
          "../api/client",
          "../contexts/AuthContext",
          "../hooks/useLocale",
        ],
        symbols: ["OnboardingPage"],
        textHints: ["onboarding", "user", "button", "locale", "api"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        textHints: ["api", "request"],
      }),
      sourceFile("src/contexts/AuthContext.tsx", {
        role: "store",
        textHints: ["auth", "session"],
      }),
      sourceFile("src/hooks/useLocale.ts", {
        role: "hook",
        textHints: ["locale", "translation"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "bugfix",
      confidence: 0.95,
      intentTags: [
        "navigation-ui",
        "header layout fix",
        "localization overflow",
      ],
      domainTerms: ["header", "text", "buttons"],
      fileRoleHints: ["component", "style"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [
          {
            kind: "explicit_file",
            value: "src/components/Header.tsx",
            path: "src/components/Header.tsx",
            confidence: 0.95,
            evidence: "Header is explicitly mentioned by the user.",
          },
        ],
        positiveActions: ["fix header overflow"],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(result.effectiveTaskArea, "ui");
  assert.equal(result.selectedFiles[0]?.path, "src/components/Header.tsx");
  assert.equal(
    result.selectedFiles.some((file) => file.path === "src/styles/global.css"),
    true,
  );
  assert.equal(
    result.selectedFiles.some(
      (file) => file.path === "src/pages/OnboardingPage.tsx",
    ),
    false,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path === "src/api/client.ts"),
    false,
  );
}

async function testUnsupportedStructuredHeaderTargetIsIgnored() {
  const result = await selectTaskFiles({
    rawTask:
      "Улучши форму добавления пользователя, чтобы поля были понятнее. Логику загрузки, удаления и API-запросы не менять.",
    taskType: "ui",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/components/Header.tsx", {
        role: "component",
        symbols: ["Header"],
        textHints: ["header", "navigation", "topbar"],
      }),
      sourceFile("src/pages/AuthPage.tsx", {
        role: "page",
        symbols: ["AuthPage"],
        textHints: ["auth", "login", "form", "email"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        textHints: ["api", "request"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [
          {
            kind: "explicit_file",
            value: "src/components/Header.tsx",
            path: "src/components/Header.tsx",
            confidence: 0.97,
            evidence:
              "Leaked schema example; the user did not mention this file.",
          },
        ],
        positiveActions: ["improve user add form"],
        protectedScopes: ["backend/api"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: ["No exact add-user form file exists in this fixture."],
        modelNotes: [],
      },
    }),
  });

  assert.deepEqual(
    result.selectedFiles.map((file) => file.path),
    [],
  );
  assert.equal(
    result.notes.some((note) => note.includes("specific UI object")),
    true,
  );
}

async function testHallucinatedHeaderHintsDoNotOverrideSpecificFormTask() {
  const result = await selectTaskFiles({
    rawTask:
      "Improve the add user form. Do not change API requests or loading.",
    taskType: "general",
    targetTool: "claude",
    inventory: inventory([
      sourceFile("src/components/Header.tsx", {
        role: "component",
        symbols: ["Header"],
        textHints: ["header", "navigation", "topbar", "language"],
      }),
      sourceFile("src/styles/global.css", {
        kind: "style",
        role: "style",
        textHints: ["topbar", "header", "navigation", "theme"],
      }),
      sourceFile("src/components/Button.tsx", {
        role: "component",
        symbols: ["Button"],
        textHints: ["button", "control"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        textHints: ["api", "request", "loading"],
      }),
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
        modelNotes: [
          "Synthetic regression: model hallucinated header terms for a form task.",
        ],
      },
    }),
  });

  assert.deepEqual(
    result.selectedFiles.map((file) => file.path),
    [],
  );
  assert.equal(
    result.notes.includes(
      "Selector safety profile: ui-specific-target-review-v5.",
    ),
    true,
  );
  assert.equal(
    result.notes.some((note) => note.includes("specific UI object")),
    true,
  );
  assert.equal(
    result.notes.some((note) =>
      note.includes("Header/navigation surface target detected"),
    ),
    false,
  );
}

async function testAdminPageFormWithProtectedApiStaysPageScoped() {
  const result = await selectTaskFiles({
    rawTask:
      "Add a user creation form to the admin page. Do not change API requests or loading.",
    taskType: "general",
    targetTool: "claude",
    inventory: inventory([
      sourceFile("src/pages/AdminPage.tsx", {
        role: "page",
        routePath: "/admin",
        imports: ["../api/client", "../hooks/useLocale"],
        symbols: ["AdminPage"],
        textHints: ["admin", "administrator", "dashboard", "users"],
      }),
      sourceFile("src/pages/AuthCallbackPage.tsx", {
        role: "page",
        routePath: "/auth/callback",
        imports: ["../api/client", "../contexts/AuthContext"],
        symbols: ["AuthCallbackPage"],
        textHints: ["auth", "callback", "session", "user"],
      }),
      sourceFile("src/hooks/useLocale.ts", {
        role: "hook",
        symbols: ["useLocale"],
        textHints: ["locale", "translation"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        symbols: ["api", "adminSummary", "syncReleases"],
        textHints: ["api", "request", "loading", "admin"],
      }),
      sourceFile("src/contexts/AuthContext.tsx", {
        role: "store",
        symbols: ["AuthProvider", "useAuth"],
        textHints: ["auth", "session", "user"],
      }),
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
        modelNotes: [
          "Synthetic regression: API and auth files must not become editable page support.",
        ],
      },
    }),
  });

  assert.deepEqual(
    result.selectedFiles.map((file) => [file.path, file.usage]),
    [
      ["src/pages/AdminPage.tsx", "inspect-and-edit"],
      ["src/hooks/useLocale.ts", "inspect-only"],
    ],
  );
  assert.equal(
    result.selectedFiles.some(
      (file) => file.path === "src/pages/AuthCallbackPage.tsx",
    ),
    false,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path === "src/api/client.ts"),
    false,
  );
  assert.equal(
    result.selectedFiles.some(
      (file) => file.path === "src/contexts/AuthContext.tsx",
    ),
    false,
  );
  assert.equal(
    result.notes.some((note) =>
      note.includes("UI/frontend files should not be selected"),
    ),
    false,
  );
}

async function testRussianAdminPageFormWithMisleadingIntentStaysAdminScoped() {
  const result = await selectTaskFiles({
    rawTask:
      "\u041d\u0443\u0436\u043d\u043e \u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043d\u0430 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430 \u0444\u043e\u0440\u043c\u0443 \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f. API-\u0437\u0430\u043f\u0440\u043e\u0441\u044b \u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0443 \u043d\u0435 \u043c\u0435\u043d\u044f\u0442\u044c.",
    taskType: "general",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/pages/AdminPage.tsx", {
        role: "page",
        routePath: "/admin",
        imports: ["../api/client", "../hooks/useLocale"],
        symbols: ["AdminPage"],
        textHints: ["admin", "administrator", "dashboard", "users"],
      }),
      sourceFile("src/pages/AccountPage.tsx", {
        role: "page",
        routePath: "/account",
        symbols: ["AccountPage"],
        textHints: ["account", "profile", "user", "settings"],
      }),
      sourceFile("src/pages/AuthCallbackPage.tsx", {
        role: "page",
        routePath: "/auth/callback",
        symbols: ["AuthCallbackPage"],
        textHints: ["auth", "callback", "session", "user"],
      }),
      sourceFile("src/hooks/useLocale.ts", {
        role: "hook",
        symbols: ["useLocale"],
        textHints: ["locale", "translation"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        symbols: ["api", "adminSummary", "syncReleases"],
        textHints: ["api", "request", "loading", "admin", "user"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      confidence: 0.95,
      domainTerms: ["admin", "form", "user", "api", "loading", "account"],
      fileRoleHints: ["api", "route", "service"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["add user creation form"],
        protectedScopes: ["api requests", "loading"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [
          "Synthetic regression: user/account terms must not outrank the concrete admin page location.",
        ],
      },
    }),
  });

  assert.equal(result.effectiveTaskArea, "ui");
  assert.equal(result.selectedFiles[0]?.path, "src/pages/AdminPage.tsx");
  assert.equal(
    result.selectedFiles.some(
      (file) => file.path === "src/pages/AccountPage.tsx",
    ),
    false,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path === "src/api/client.ts"),
    false,
  );
  assert.equal(
    result.notes.some((note) =>
      note.includes("UI/frontend files should not be selected"),
    ),
    false,
  );
}

async function testStructuredRussianAdminPageTargetDoesNotBlock() {
  const result = await selectTaskFiles({
    rawTask:
      "\u041d\u0443\u0436\u043d\u043e \u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043d\u0430 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430 \u0444\u043e\u0440\u043c\u0443 \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f. API-\u0437\u0430\u043f\u0440\u043e\u0441\u044b \u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0443 \u043d\u0435 \u043c\u0435\u043d\u044f\u0442\u044c.",
    taskType: "general",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/pages/AdminPage.tsx", {
        role: "page",
        imports: ["../api/client", "../hooks/useLocale"],
        symbols: ["AdminPage"],
        textHints: ["admin", "administrator", "dashboard", "users"],
      }),
      sourceFile("src/pages/AccountPage.tsx", {
        role: "page",
        symbols: ["AccountPage"],
        textHints: ["account", "profile", "user", "settings"],
      }),
      sourceFile("src/hooks/useLocale.ts", {
        role: "hook",
        symbols: ["useLocale"],
        textHints: ["locale", "translation"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        textHints: ["api", "request", "loading", "admin", "user"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      confidence: 0.95,
      domainTerms: ["admin", "form", "user", "api", "loading"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [
          {
            kind: "explicit_file",
            value: "src/pages/AdminPage.tsx",
            path: "src/pages/AdminPage.tsx",
            confidence: 0.95,
            evidence: "Admin page inferred from the requested page location.",
          },
        ],
        positiveActions: ["add user creation form"],
        protectedScopes: ["api requests", "loading"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(result.effectiveTaskArea, "ui");
  assert.equal(result.selectedFiles[0]?.path, "src/pages/AdminPage.tsx");
  assert.equal(
    result.selectedFiles.some(
      (file) => file.path === "src/pages/AccountPage.tsx",
    ),
    false,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path === "src/api/client.ts"),
    false,
  );
}

async function testConnectedDevicesProtectedBackendDoesNotProtectUi() {
  const result = await selectTaskFiles({
    rawTask:
      "Improve connected devices pairing code screen. Backend pairing API should not change.",
    taskType: "general",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/pages/DevicesPage.tsx", {
        role: "page",
        routePath: "/devices",
        imports: ["../api/client", "../hooks/useLocale"],
        symbols: ["DevicesPage"],
        textHints: ["devices", "connected", "pairing", "code", "screen"],
      }),
      sourceFile("src/pages/AccountPage.tsx", {
        role: "page",
        routePath: "/account",
        symbols: ["AccountPage"],
        textHints: ["account", "profile", "user"],
      }),
      sourceFile("src/hooks/useLocale.ts", {
        role: "hook",
        symbols: ["useLocale"],
        textHints: ["locale", "translation"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        symbols: ["requestPairingCode", "pairDesktop"],
        textHints: ["api", "backend", "pairing", "devices"],
      }),
      sourceFile("server/index.mjs", {
        role: "server-entry",
        textHints: ["server", "api", "pairing", "devices"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["connected devices", "pairing code", "backend", "api"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["improve connected devices pairing code screen"],
        protectedScopes: ["backend pairing api"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(result.effectiveTaskArea, "ui");
  assert.equal(result.selectedFiles[0]?.path, "src/pages/DevicesPage.tsx");
  assert.equal(
    result.selectedFiles.some((file) => file.path === "src/api/client.ts"),
    false,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path.startsWith("server/")),
    false,
  );
  assert.equal(
    result.notes.some((note) =>
      note.includes("UI/frontend files should not be selected"),
    ),
    false,
  );
}

async function testUnscopedAddUserFormBlocksInsteadOfGuessingAccountPages() {
  const result = await selectTaskFiles({
    rawTask:
      "Improve the add user form. Do not change API requests or loading.",
    taskType: "general",
    targetTool: "claude",
    inventory: inventory([
      sourceFile("src/pages/AccountPage.tsx", {
        role: "page",
        routePath: "/account",
        symbols: ["AccountPage"],
        textHints: ["account", "user", "profile", "settings"],
      }),
      sourceFile("src/pages/AuthCallbackPage.tsx", {
        role: "page",
        routePath: "/auth/callback",
        symbols: ["AuthCallbackPage"],
        textHints: ["auth", "callback", "user", "loading"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        textHints: ["api", "request", "loading", "user"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["form", "user", "api", "loading"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["improve add user form"],
        protectedScopes: ["api requests", "loading"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [
          "No concrete add-user form target exists in this fixture.",
        ],
        modelNotes: [],
      },
    }),
  });

  assert.deepEqual(
    result.selectedFiles.map((file) => file.path),
    [],
  );
  assert.equal(
    result.notes.some((note) => note.includes("specific UI object")),
    true,
  );
}

async function testRussianApiRequestsProtectedInMissingFormTask() {
  const result = await selectTaskFiles({
    rawTask:
      "Улучши форму добавления пользователя. API-запросы и загрузку не менять.",
    taskType: "general",
    targetTool: "claude",
    inventory: inventory([
      sourceFile("src/pages/AccountPage.tsx", {
        role: "page",
        routePath: "/account",
        symbols: ["AccountPage"],
        textHints: ["account", "user", "profile", "settings"],
      }),
      sourceFile("src/pages/AuthCallbackPage.tsx", {
        role: "page",
        routePath: "/auth/callback",
        symbols: ["AuthCallbackPage"],
        textHints: ["auth", "callback", "user", "loading"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        textHints: ["api", "request", "loading", "user"],
      }),
      sourceFile("server/index.mjs", {
        role: "server-entry",
        textHints: ["server", "api", "user"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "backend",
      confidence: 0.8,
      domainTerms: ["form", "user", "api", "loading"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["improve add user form"],
        protectedScopes: ["api requests", "loading"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [
          "No concrete add-user form target exists in this fixture.",
        ],
        modelNotes: [],
      },
    }),
  });

  assert.notEqual(result.effectiveTaskArea, "backend");
  assert.deepEqual(
    result.selectedFiles.map((file) => file.path),
    [],
  );
  assert.equal(
    result.notes.some((note) => note.includes("specific UI object")),
    true,
  );
}

async function testQualitySignalsExplainBlockedMissingTarget() {
  const projectInventory = inventory([
    sourceFile("src/pages/AccountPage.tsx", {
      role: "page",
      routePath: "/account",
      symbols: ["AccountPage"],
      textHints: ["account", "user", "profile", "settings"],
    }),
    sourceFile("src/api/client.ts", {
      role: "client-api",
      textHints: ["api", "request", "loading", "user"],
    }),
    sourceFile("server/index.mjs", {
      role: "server-entry",
      textHints: ["server", "api", "user"],
    }),
  ]);
  const rawTask =
    "Improve the add user form. Do not change API requests or loading.";
  const result = await selectTaskFiles({
    rawTask,
    taskType: "general",
    targetTool: "claude",
    inventory: projectInventory,
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["form", "user", "api", "loading"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["improve add user form"],
        protectedScopes: ["api requests", "loading"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [
          "No concrete add-user form target exists in this fixture.",
        ],
        modelNotes: [],
      },
    }),
  });
  const quality = evaluateContextSelectionQuality({
    rawTask,
    requestedTaskType: "general",
    effectiveTaskArea: result.effectiveTaskArea,
    inventory: projectInventory,
    fileSelection: result,
    manualSelectionConfirmed: false,
    contextQualityMode: "balanced",
  });

  assert.equal(quality.status, "blocked");
  assert.equal(quality.signals.targetConfidence, 0);
  assert.equal(quality.signals.contextCompleteness, 0);
  assert.equal(quality.signals.protectedScopeRisk < 50, true);
  assert.equal(
    quality.signals.nextActions.some((action) =>
      action.includes("Search for the exact"),
    ),
    true,
  );
}

async function testReleaseAdminEmptyStateKeepsBackendProtected() {
  const result = await selectTaskFiles({
    rawTask:
      "На экране, где админ управляет релизами, добавь аккуратное пустое состояние. Backend не трогать.",
    taskType: "general",
    targetTool: "claude",
    inventory: inventory([
      sourceFile("src/pages/AdminPage.tsx", {
        role: "page",
        routePath: "/admin",
        imports: ["../api/client", "../hooks/useLocale"],
        symbols: ["AdminPage"],
        textHints: ["admin", "releases", "dashboard"],
      }),
      sourceFile("src/pages/ReleasesPage.tsx", {
        role: "page",
        routePath: "/releases",
        imports: ["../api/client", "../hooks/useLocale"],
        symbols: ["ReleasesPage"],
        textHints: ["release", "releases", "empty", "state", "version"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        symbols: ["api", "getReleases"],
        textHints: ["api", "releases", "request"],
      }),
      sourceFile("src/hooks/useLocale.ts", {
        role: "hook",
        symbols: ["useLocale"],
        textHints: ["locale", "translation"],
      }),
      sourceFile("server/index.ts", {
        role: "server-entry",
        textHints: ["server", "backend", "api"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["admin", "releases", "empty state", "backend"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["add polished empty state on releases admin screen"],
        protectedScopes: ["backend"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(
    result.selectedFiles.some(
      (file) =>
        file.path === "src/pages/ReleasesPage.tsx" ||
        file.path === "src/pages/AdminPage.tsx",
    ),
    true,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path === "src/api/client.ts"),
    false,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path.startsWith("server/")),
    false,
  );
}

async function testSemanticGraphResolvesPageSupportEdges() {
  const projectInventory = inventory([
    sourceFile("src/pages/ProductPage.tsx", {
      role: "page",
      routePath: "/product",
      imports: [
        "../components/ProductForm",
        "../hooks/useLocale",
        "../api/client",
        "../styles/product.css",
      ],
      symbols: ["ProductPage"],
      textHints: ["product", "form"],
    }),
    sourceFile("src/components/ProductForm.tsx", {
      role: "component",
      symbols: ["ProductForm"],
      textHints: ["product", "form", "fields"],
    }),
    sourceFile("src/hooks/useLocale.ts", {
      role: "hook",
      symbols: ["useLocale"],
      textHints: ["locale", "translation"],
    }),
    sourceFile("src/api/client.ts", {
      role: "client-api",
      symbols: ["api"],
      textHints: ["api", "request"],
    }),
    sourceFile("src/styles/product.css", {
      kind: "style",
      role: "style",
      textHints: ["product", "form", "layout"],
    }),
  ]);

  const graph = buildProjectSemanticGraph(projectInventory);
  const support = graph.getSupportFiles(["src/pages/ProductPage.tsx"], {
    maxPerTarget: 8,
  });
  const supportByPath = new Map(
    support.map((item) => [item.file.path, item.edge.kind]),
  );

  assert.equal(
    supportByPath.get("src/components/ProductForm.tsx"),
    "component-import",
  );
  assert.equal(supportByPath.get("src/hooks/useLocale.ts"), "hook-import");
  assert.equal(supportByPath.get("src/api/client.ts"), "client-api-import");
  assert.equal(supportByPath.get("src/styles/product.css"), "style-import");
}

async function testSelectorUsesSemanticGraphSupportWithoutProtectedApi() {
  const result = await selectTaskFiles({
    rawTask: "Improve the product page form. Do not change API requests.",
    taskType: "ui",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/pages/ProductPage.tsx", {
        role: "page",
        routePath: "/product",
        imports: [
          "../components/ProductForm",
          "../hooks/useLocale",
          "../api/client",
        ],
        symbols: ["ProductPage"],
        textHints: ["product", "form"],
      }),
      sourceFile("src/components/ProductForm.tsx", {
        role: "component",
        symbols: ["ProductForm"],
        textHints: ["product", "form", "fields"],
      }),
      sourceFile("src/hooks/useLocale.ts", {
        role: "hook",
        symbols: ["useLocale"],
        textHints: ["locale", "translation"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        symbols: ["api"],
        textHints: ["api", "request", "product"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["product", "page", "form", "api", "requests"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["improve product page form"],
        protectedScopes: ["api requests"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(
    result.selectedFiles.some(
      (file) => file.path === "src/pages/ProductPage.tsx",
    ),
    true,
  );
  assert.equal(
    result.selectedFiles.some(
      (file) => file.path === "src/components/ProductForm.tsx",
    ),
    true,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path === "src/api/client.ts"),
    false,
  );
  assert.equal(
    result.selectedFiles.some((file) =>
      file.reason.includes("Semantic graph support"),
    ),
    true,
  );
}

async function testVisualOnlyAccountBadgesDowngradesAuthSupport() {
  const result = await selectTaskFiles({
    rawTask:
      "On the account page, make beautiful badges for connected OAuth providers.",
    taskType: "general",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/pages/AccountPage.tsx", {
        role: "page",
        imports: [
          "../api/client",
          "../contexts/AuthContext",
          "../contexts/NotificationContext",
          "../components/GoogleIcon",
          "../components/ProviderBadge",
        ],
        symbols: ["AccountPage", "providerLabel"],
        textHints: ["account", "profile", "provider", "oauth", "badge"],
      }),
      sourceFile("src/pages/AuthCallbackPage.tsx", {
        role: "page",
        symbols: ["AuthCallbackPage"],
        textHints: ["auth", "callback", "oauth", "provider", "redirect"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        symbols: ["api"],
        textHints: ["api", "oauth", "provider", "request"],
      }),
      sourceFile("src/contexts/AuthContext.tsx", {
        role: "store",
        symbols: ["AuthContext", "useAuth"],
        textHints: ["auth", "session", "user", "provider"],
      }),
      sourceFile("src/contexts/NotificationContext.tsx", {
        role: "store",
        symbols: ["NotificationContext", "useNotify"],
        textHints: ["notification", "toast", "message"],
      }),
      sourceFile("src/components/GoogleIcon.tsx", {
        role: "component",
        symbols: ["GoogleIcon"],
        textHints: ["google", "provider", "icon"],
      }),
      sourceFile("src/components/ProviderBadge.tsx", {
        role: "component",
        symbols: ["ProviderBadge"],
        textHints: ["provider", "badge", "oauth", "visual"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "backend",
      confidence: 0.9,
      fileRoleHints: ["api", "auth", "client-api"],
      domainTerms: ["account", "oauth", "provider", "badges"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["make provider badges visually polished"],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  const accountPage = result.selectedFiles.find(
    (file) => file.path === "src/pages/AccountPage.tsx",
  );
  const apiClient = result.selectedFiles.find(
    (file) => file.path === "src/api/client.ts",
  );
  const authContext = result.selectedFiles.find(
    (file) => file.path === "src/contexts/AuthContext.tsx",
  );
  const notificationContext = result.selectedFiles.find(
    (file) => file.path === "src/contexts/NotificationContext.tsx",
  );
  const providerBadge = result.selectedFiles.find(
    (file) => file.path === "src/components/ProviderBadge.tsx",
  );

  assert.equal(result.effectiveTaskArea, "ui");
  assert.equal(accountPage?.usage, "inspect-and-edit");
  assert.notEqual(
    result.selectedFiles[0]?.path,
    "src/pages/AuthCallbackPage.tsx",
  );
  assert.equal(apiClient?.usage, "inspect-only");
  assert.equal(authContext?.usage, "inspect-only");
  assert.equal(notificationContext?.usage, "inspect-only");
  assert.equal(providerBadge?.usage, "inspect-and-edit");
}

async function testCallbackFlowStillAllowsAuthSupport() {
  const result = await selectTaskFiles({
    rawTask:
      "Fix the OAuth callback page after login redirect and verify session handling.",
    taskType: "general",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/pages/AccountPage.tsx", {
        role: "page",
        symbols: ["AccountPage"],
        textHints: ["account", "profile", "provider"],
      }),
      sourceFile("src/pages/AuthCallbackPage.tsx", {
        role: "page",
        imports: ["../api/client", "../contexts/AuthContext"],
        symbols: ["AuthCallbackPage"],
        textHints: [
          "auth",
          "callback",
          "oauth",
          "provider",
          "redirect",
          "session",
        ],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        symbols: ["api", "completeOAuth"],
        textHints: ["api", "oauth", "callback", "request"],
      }),
      sourceFile("src/contexts/AuthContext.tsx", {
        role: "store",
        symbols: ["AuthContext", "useAuth"],
        textHints: ["auth", "session", "user", "provider"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["oauth", "callback", "redirect", "session"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["fix oauth callback after login redirect"],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: false,
        needsBackend: null,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(
    result.selectedFiles.some(
      (file) => file.path === "src/pages/AuthCallbackPage.tsx",
    ),
    true,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path === "src/api/client.ts"),
    true,
  );
  assert.equal(
    result.selectedFiles.some(
      (file) => file.path === "src/contexts/AuthContext.tsx",
    ),
    true,
  );
}

async function testUiTriggerApiRequestIsFullstack() {
  const result = await selectTaskFiles({
    rawTask: "Connect the account provider badge click to an API request.",
    taskType: "general",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/pages/AccountPage.tsx", {
        role: "page",
        imports: ["../api/client", "../components/Badge"],
        symbols: ["AccountPage", "handleProviderBadgeClick"],
        textHints: ["account", "provider", "badge", "click"],
      }),
      sourceFile("src/pages/OnboardingPage.tsx", {
        role: "page",
        symbols: ["OnboardingPage"],
        textHints: ["onboarding", "setup", "connect", "account"],
      }),
      sourceFile("src/components/RouteSkeleton.tsx", {
        role: "component",
        symbols: ["RouteSkeleton"],
        textHints: ["route", "skeleton", "loading"],
      }),
      sourceFile("src/components/Badge.tsx", {
        role: "component",
        symbols: ["Badge"],
        textHints: ["badge", "click", "provider"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        symbols: ["api"],
        textHints: ["api", "request", "provider"],
      }),
      sourceFile("server/index.mjs", {
        role: "server-entry",
        symbols: ["handleProviderBadge"],
        textHints: ["api", "provider", "request", "server"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "backend",
      confidence: 0.7,
      domainTerms: ["account", "provider", "badge", "api"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["connect badge click to api request"],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: false,
        needsBackend: true,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(result.effectiveTaskArea, "fullstack");
  assert.equal(
    result.selectedFiles.some(
      (file) => file.path === "src/pages/AccountPage.tsx",
    ),
    true,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path === "src/api/client.ts"),
    true,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path === "server/index.mjs"),
    true,
  );
  assert.equal(
    result.selectedFiles.some(
      (file) => file.path === "src/pages/OnboardingPage.tsx",
    ),
    false,
  );
  assert.equal(
    result.selectedFiles.some(
      (file) => file.path === "src/components/RouteSkeleton.tsx",
    ),
    false,
  );
}

async function testStrictMissingOrdersPageBlocksInsteadOfWeakBodyMatch() {
  const result = await selectTaskFiles({
    rawTask: "Сделай красивую страницу управления заказами.",
    taskType: "ui",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/app/(site)/steel/page.tsx", {
        role: "page",
        routePath: "/steel",
        symbols: ["SteelPage"],
        textHints: ["марки стали", "склад", "под заказ"],
        contentPreview:
          "<h1>Марки стали</h1><p>Поставки под заказ в короткие сроки.</p>",
      }),
      sourceFile("src/app/(site)/contacts/page.tsx", {
        role: "page",
        routePath: "/contacts",
        symbols: ["ContactsPage"],
        textHints: ["контакты"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["страница", "управление", "заказы"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["make order management page beautiful"],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(result.selectedFiles.length, 0);
  assert.equal(
    result.notes.some((note) =>
      note.includes("Strict page target guard blocked"),
    ),
    true,
  );
}

async function testAdminPageMissingBlocksInsteadOfAccountFallback() {
  const result = await selectTaskFiles({
    rawTask:
      "Нужно добавить на страницу администратора форму добавления пользователя. API-запросы и загрузку не менять.",
    taskType: "general",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/pages/AccountPage.tsx", {
        role: "page",
        routePath: "/account",
        symbols: ["AccountPage"],
        textHints: ["account", "profile", "user"],
      }),
      sourceFile("src/api/client.ts", {
        role: "client-api",
        symbols: ["api"],
        textHints: ["api", "request", "users"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["admin", "user", "form"],
      fileRoleHints: ["api"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["add user form to admin page"],
        protectedScopes: ["api requests", "loading"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(result.selectedFiles.length, 0);
}

async function testPackageIntentAddsPackageJsonAndNarrowsHomePage() {
  const result = await selectTaskFiles({
    rawTask:
      "Добавь библиотеку для анимаций и используй её на главной странице.",
    taskType: "ui",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/pages/HomePage.tsx", {
        role: "page",
        routePath: "/",
        symbols: ["HomePage"],
        imports: ["../components/Hero"],
        textHints: ["home", "landing", "главная", "hero"],
      }),
      sourceFile("src/pages/AccountPage.tsx", {
        role: "page",
        routePath: "/account",
        symbols: ["AccountPage"],
        textHints: ["account", "profile", "animation"],
      }),
      sourceFile("src/components/Hero.tsx", {
        role: "component",
        symbols: ["Hero"],
        textHints: ["home", "hero"],
      }),
      sourceFile("package.json", {
        kind: "config",
        role: "config",
        textHints: ["package", "dependencies", "framer-motion"],
        contentPreview: '{ "dependencies": { "framer-motion": "^12.0.0" } }',
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["home", "animation", "library"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["add animation library on homepage"],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(
    result.selectedFiles.some(
      (file) =>
        file.path === "src/pages/HomePage.tsx" &&
        file.usage === "inspect-and-edit",
    ),
    true,
  );
  assert.equal(
    result.selectedFiles.some(
      (file) =>
        file.path === "src/pages/AccountPage.tsx" &&
        file.usage === "inspect-and-edit",
    ),
    false,
  );
  assert.equal(
    result.selectedFiles.some((file) => file.path === "package.json"),
    true,
  );
}

async function testCreateMissingExplicitPagePathCreatesPlannedFile() {
  const result = await selectTaskFiles({
    rawTask:
      "Создай новую страницу src/pages/BillingPage.tsx с карточками тарифов.",
    taskType: "ui",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/App.tsx", {
        role: "app-entry",
        imports: ["react-router-dom"],
        textHints: ["routes", "router", "pages"],
      }),
      sourceFile("src/pages/HomePage.tsx", {
        role: "page",
        routePath: "/",
        symbols: ["HomePage"],
        textHints: ["home", "landing"],
      }),
      sourceFile("src/styles/global.css", {
        kind: "style",
        role: "style",
        textHints: ["global", "page", "card"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["billing", "pricing", "page"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["create new billing page"],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(
    result.selectedFiles.some(
      (file) =>
        file.path === "src/pages/BillingPage.tsx" &&
        file.usage === "create-and-edit",
    ),
    true,
  );
  assert.equal(
    result.selectedFiles.some(
      (file) =>
        file.path === "src/pages/HomePage.tsx" && file.usage === "inspect-only",
    ),
    true,
  );
}

async function testCreateRouteInfersReactRouterPageAndRouteRegistration() {
  const result = await selectTaskFiles({
    rawTask: "Добавь новую страницу /pricing для тарифов.",
    taskType: "ui",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/App.tsx", {
        role: "app-entry",
        imports: ["react-router-dom", "./pages/HomePage"],
        textHints: ["BrowserRouter", "Routes", "Route", "pages"],
      }),
      sourceFile("src/pages/HomePage.tsx", {
        role: "page",
        routePath: "/",
        symbols: ["HomePage"],
        textHints: ["home", "landing"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["pricing", "page"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["add new page /pricing"],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(
    result.selectedFiles.some(
      (file) =>
        file.path === "src/pages/PricingPage.tsx" &&
        file.usage === "create-and-edit",
    ),
    true,
  );
  assert.equal(
    result.selectedFiles.some(
      (file) =>
        file.path === "src/App.tsx" && file.usage === "inspect-and-edit",
    ),
    true,
  );
}

async function testCreateRouteUsesExistingPageWhenInferredFileExists() {
  const result = await selectTaskFiles({
    rawTask: "Добавь новую страницу /pricing для тарифов.",
    taskType: "ui",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/App.tsx", {
        role: "app-entry",
        imports: [
          "react-router-dom",
          "./pages/HomePage",
          "./pages/PricingPage",
        ],
        textHints: ["BrowserRouter", "Routes", "Route", "pages"],
      }),
      sourceFile("src/pages/HomePage.tsx", {
        role: "page",
        routePath: "/",
        symbols: ["HomePage"],
        textHints: ["home", "landing"],
      }),
      sourceFile("src/pages/PricingPage.tsx", {
        role: "page",
        symbols: ["PricingPage"],
        textHints: ["pricing", "tariffs", "тарифы"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["pricing", "page", "тарифы"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [
          {
            kind: "explicit_file",
            value: "src/pages/PricingPage.tsx",
            path: "src/pages/PricingPage.tsx",
            confidence: 0.9,
            evidence: "inferred from /pricing route",
          },
        ],
        positiveActions: ["add new page /pricing"],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(
    result.selectedFiles.some(
      (file) =>
        file.path === "src/pages/PricingPage.tsx" &&
        file.usage === "inspect-and-edit",
    ),
    true,
  );
  assert.equal(
    result.selectedFiles.some(
      (file) =>
        file.path === "src/pages/PricingPage.tsx" &&
        file.usage === "create-and-edit",
    ),
    false,
  );
}

async function testUnsafeCreatePathBlocks() {
  const result = await selectTaskFiles({
    rawTask: "Создай файл ../../.env и положи туда настройки.",
    taskType: "general",
    targetTool: "codex",
    inventory: inventory([
      sourceFile("src/App.tsx", {
        role: "app-entry",
        textHints: ["app"],
      }),
    ]),
    settings: testSettings,
    taskIntent: structuredIntent({
      taskArea: "ui",
      domainTerms: ["env", "settings"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["create file ../../.env"],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: false,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
    }),
  });

  assert.equal(result.selectedFiles.length, 0);
  assert.equal(
    result.notes.some((note) =>
      note.includes("unsafe/out-of-scope path(s) were requested"),
    ),
    true,
  );
}

async function testEnvFilesAreNotReadIntoInventory() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "contextforge-selector-"),
  );
  await fs.writeFile(
    path.join(root, ".env"),
    "SESSION_SECRET=super-secret-value\nDATABASE_URL=postgresql://user:pass@localhost/db\n",
  );
  await fs.writeFile(
    path.join(root, ".env.example"),
    "SESSION_SECRET=example\nDATABASE_URL=postgresql://user:pass@localhost/db\n",
  );
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    "export const metadata = { title: 'Home' };\nexport default function Page(){ return <h1>Home</h1>; }\n",
  );

  const scanned = await scanProjectInventory(root);
  const envFile = scanned.files.find((file) => file.path === ".env");
  const envExampleFile = scanned.files.find(
    (file) => file.path === ".env.example",
  );

  assert.equal(envFile?.canReadText, false);
  assert.equal(envFile?.contentPreview, undefined);
  assert.equal(envExampleFile?.canReadText, true);
  assert.equal(
    envExampleFile?.contentPreview?.includes("super-secret-value"),
    false,
  );
}

async function main() {
  await testSemanticPageTargetUnicode();
  await testHeaderTaskDoesNotBecomeRootPageTask();
  await testExplicitRussianHeaderFileDoesNotBlockReview();
  await testStructuredIntentCanSeedExplicitTarget();
  await testStructuredIntentCanSeedSemanticPageTarget();
  await testProtectedApiTerms();
  await testGeneralHeaderTaskWithBackendConstraintStaysUi();
  await testStructuredHeaderTargetCannotBeDisplacedByPageFallback();
  await testUnsupportedStructuredHeaderTargetIsIgnored();
  await testHallucinatedHeaderHintsDoNotOverrideSpecificFormTask();
  await testAdminPageFormWithProtectedApiStaysPageScoped();
  await testRussianAdminPageFormWithMisleadingIntentStaysAdminScoped();
  await testStructuredRussianAdminPageTargetDoesNotBlock();
  await testConnectedDevicesProtectedBackendDoesNotProtectUi();
  await testUnscopedAddUserFormBlocksInsteadOfGuessingAccountPages();
  await testRussianApiRequestsProtectedInMissingFormTask();
  await testQualitySignalsExplainBlockedMissingTarget();
  await testReleaseAdminEmptyStateKeepsBackendProtected();
  await testSemanticGraphResolvesPageSupportEdges();
  await testSelectorUsesSemanticGraphSupportWithoutProtectedApi();
  await testVisualOnlyAccountBadgesDowngradesAuthSupport();
  await testCallbackFlowStillAllowsAuthSupport();
  await testUiTriggerApiRequestIsFullstack();
  await testStrictMissingOrdersPageBlocksInsteadOfWeakBodyMatch();
  await testAdminPageMissingBlocksInsteadOfAccountFallback();
  await testPackageIntentAddsPackageJsonAndNarrowsHomePage();
  await testCreateMissingExplicitPagePathCreatesPlannedFile();
  await testCreateRouteInfersReactRouterPageAndRouteRegistration();
  await testCreateRouteUsesExistingPageWhenInferredFileExists();
  await testUnsafeCreatePathBlocks();
  await testEnvFilesAreNotReadIntoInventory();
  console.log("taskFileSelector smoke tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
