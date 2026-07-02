import assert from "node:assert/strict";
import path from "node:path";

import type { ProjectInventory, ProjectInventoryFile } from "../scanner/projectInventoryScanner.js";
import { evaluateContextSelectionQuality } from "../selection/contextQuality.js";
import type { AppSettings } from "../settings/settingsService.js";
import type { TaskIntentAnalysis, TaskArea, StructuredTaskIntent } from "./taskIntentAnalyzer.js";
import { selectTaskFiles } from "./taskFileSelector.js";

const replaySettings: AppSettings = {
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
    sizeBytes: 1600,
    depth: pathValue.split("/").length,
    canReadText: true,
    isLikelyGenerated: false,
    ...patch
  };
}

function fixtureInventory(): ProjectInventory {
  const files: ProjectInventoryFile[] = [
    sourceFile("src/components/Header.tsx", {
      role: "component",
      symbols: ["Header"],
      textHints: ["header", "topbar", "navigation", "nav", "menu", "language", "locale", "account", "more"]
    }),
    sourceFile("src/components/Footer.tsx", {
      role: "component",
      symbols: ["Footer"],
      textHints: ["footer", "links", "legal", "docs", "company"]
    }),
    sourceFile("src/components/Button.tsx", {
      role: "ui-component",
      symbols: ["Button"],
      textHints: ["button", "cta", "control"]
    }),
    sourceFile("src/components/SearchBox.tsx", {
      role: "component",
      symbols: ["SearchBox"],
      textHints: ["search", "filter", "input"]
    }),
    sourceFile("src/components/ProviderBadge.tsx", {
      role: "component",
      symbols: ["ProviderBadge"],
      textHints: ["provider", "badge", "google", "github", "account", "oauth"]
    }),
    sourceFile("src/components/PricingCard.tsx", {
      role: "component",
      symbols: ["PricingCard"],
      textHints: ["pricing", "plan", "billing", "card"]
    }),
    sourceFile("src/components/RouteSkeleton.tsx", {
      role: "component",
      symbols: ["RouteSkeleton"],
      textHints: ["loading", "skeleton", "fallback"]
    }),
    sourceFile("src/styles/global.css", {
      kind: "style",
      role: "style",
      textHints: ["global", "layout", "header", "topbar", "footer", "responsive", "grid"]
    }),
    sourceFile("src/styles/account.css", {
      kind: "style",
      role: "style",
      textHints: ["account", "profile", "avatar", "provider", "badge"]
    }),
    sourceFile("src/pages/HomePage.tsx", {
      role: "page",
      routePath: "/",
      symbols: ["HomePage"],
      imports: ["../components/Header", "../components/Footer"],
      textHints: ["home", "landing", "hero", "features"]
    }),
    sourceFile("src/pages/AccountPage.tsx", {
      role: "page",
      routePath: "/account",
      symbols: ["AccountPage"],
      imports: ["../components/ProviderBadge", "../api/client", "../contexts/AuthContext", "../styles/account.css"],
      textHints: ["account", "profile", "avatar", "email", "provider", "providers", "badge", "license", "user"]
    }),
    sourceFile("src/pages/AdminPage.tsx", {
      role: "page",
      routePath: "/admin",
      symbols: ["AdminPage"],
      imports: ["../api/client", "../hooks/useLocale"],
      textHints: ["admin", "administrator", "users", "releases", "dashboard", "form"]
    }),
    sourceFile("src/pages/AuthPage.tsx", {
      role: "page",
      routePath: "/auth",
      symbols: ["AuthPage"],
      imports: ["../api/client", "../contexts/AuthContext"],
      textHints: ["auth", "login", "sign in", "oauth", "google", "github", "form"]
    }),
    sourceFile("src/pages/AuthCallbackPage.tsx", {
      role: "page",
      routePath: "/auth/callback",
      symbols: ["AuthCallbackPage"],
      imports: ["../api/client", "../contexts/AuthContext"],
      textHints: ["auth", "callback", "oauth", "loading", "session"]
    }),
    sourceFile("src/pages/DashboardPage.tsx", {
      role: "page",
      routePath: "/dashboard",
      symbols: ["DashboardPage"],
      textHints: ["dashboard", "metrics", "recent activity", "checklist", "quick actions"]
    }),
    sourceFile("src/pages/DevicesPage.tsx", {
      role: "page",
      routePath: "/devices",
      symbols: ["DevicesPage"],
      imports: ["../api/client"],
      textHints: ["devices", "connected devices", "desktop", "pairing", "heartbeat"]
    }),
    sourceFile("src/pages/ConnectPage.tsx", {
      role: "page",
      routePath: "/connect",
      symbols: ["ConnectPage"],
      imports: ["../api/client", "../contexts/NotificationContext", "../hooks/useLocale"],
      textHints: ["connect", "contact", "waitlist", "newsletter", "message"]
    }),
    sourceFile("src/pages/ApiKeysPage.tsx", {
      role: "page",
      routePath: "/api-keys",
      symbols: ["ApiKeysPage"],
      imports: ["../api/client"],
      textHints: ["api keys", "key", "token", "scopes", "create api key"]
    }),
    sourceFile("src/pages/UsagePage.tsx", {
      role: "page",
      routePath: "/usage",
      symbols: ["UsagePage"],
      textHints: ["usage", "quota", "events", "limits"]
    }),
    sourceFile("src/pages/BillingPage.tsx", {
      role: "page",
      routePath: "/billing",
      symbols: ["BillingPage"],
      textHints: ["billing", "payment", "invoice", "plan"]
    }),
    sourceFile("src/pages/WorkspacePage.tsx", {
      role: "page",
      routePath: "/workspace",
      symbols: ["WorkspacePage"],
      textHints: ["workspace", "team", "members", "invite"]
    }),
    sourceFile("src/pages/PricingPage.tsx", {
      role: "page",
      routePath: "/pricing",
      symbols: ["PricingPage"],
      imports: ["../components/PricingCard"],
      textHints: ["pricing", "plans", "tiers", "billing"]
    }),
    sourceFile("src/pages/StatusPage.tsx", {
      role: "page",
      routePath: "/status",
      symbols: ["StatusPage"],
      textHints: ["status", "uptime", "operational", "incident"]
    }),
    sourceFile("src/pages/SecurityPage.tsx", {
      role: "page",
      routePath: "/security",
      symbols: ["SecurityPage"],
      textHints: ["security", "privacy", "tokens", "sessions"]
    }),
    sourceFile("src/pages/ReleasesPage.tsx", {
      role: "page",
      routePath: "/releases",
      symbols: ["ReleasesPage"],
      imports: ["../api/client"],
      textHints: ["releases", "version", "download", "checksum", "asset", "changelog"]
    }),
    sourceFile("src/pages/DownloadPage.tsx", {
      role: "page",
      routePath: "/download",
      symbols: ["DownloadPage"],
      imports: ["../api/client"],
      textHints: ["download", "installer", "release", "windows", "mac", "linux"]
    }),
    sourceFile("src/pages/DocsPage.tsx", {
      role: "page",
      routePath: "/docs",
      symbols: ["DocsPage"],
      textHints: ["docs", "documentation", "guide", "setup"]
    }),
    sourceFile("src/pages/DevelopersPage.tsx", {
      role: "page",
      routePath: "/developers",
      symbols: ["DevelopersPage"],
      textHints: ["developers", "api", "reference", "curl", "sdk"]
    }),
    sourceFile("src/pages/RoadmapPage.tsx", {
      role: "page",
      routePath: "/roadmap",
      symbols: ["RoadmapPage"],
      textHints: ["roadmap", "planned", "milestone"]
    }),
    sourceFile("src/pages/ChangelogPage.tsx", {
      role: "page",
      routePath: "/changelog",
      symbols: ["ChangelogPage"],
      textHints: ["changelog", "changes", "history", "release notes"]
    }),
    sourceFile("src/pages/LegalPage.tsx", {
      role: "page",
      routePath: "/legal",
      symbols: ["LegalPage"],
      textHints: ["legal", "terms", "privacy", "policy"]
    }),
    sourceFile("src/pages/OnboardingPage.tsx", {
      role: "page",
      routePath: "/onboarding",
      symbols: ["OnboardingPage"],
      textHints: ["onboarding", "setup", "welcome", "checklist"]
    }),
    sourceFile("src/api/client.ts", {
      role: "client-api",
      symbols: ["api", "request", "getSession", "getReleases", "createApiKey"],
      textHints: ["api", "request", "fetch", "session", "releases", "api keys", "desktop"]
    }),
    sourceFile("src/contexts/AuthContext.tsx", {
      role: "store",
      symbols: ["AuthContext", "useAuth"],
      textHints: ["auth", "session", "user", "provider", "account"]
    }),
    sourceFile("src/hooks/useLocale.ts", {
      role: "hook",
      symbols: ["useLocale"],
      textHints: ["locale", "translation", "language"]
    }),
    sourceFile("server/index.mjs", {
      role: "server-entry",
      textHints: ["server", "api", "oauth", "session", "desktop", "releases", "api keys"]
    }),
    sourceFile("server/schema.sql", {
      kind: "data",
      role: "db-schema",
      textHints: ["database", "schema", "users", "sessions", "oauth", "api keys", "desktop"]
    }),
    sourceFile("server/services/releases.ts", {
      role: "service",
      textHints: ["releases", "github", "sync", "assets", "checksum"]
    }),
    sourceFile("README.md", {
      kind: "docs",
      role: "docs",
      textHints: ["readme", "setup", "commands", "development"]
    }),
    sourceFile("API_REFERENCE.md", {
      kind: "docs",
      role: "docs",
      textHints: ["api reference", "curl", "desktop", "api keys", "releases"]
    }),
    sourceFile("package.json", {
      kind: "config",
      role: "config",
      textHints: ["package", "dependencies", "scripts", "framer-motion", "vite", "react"],
      contentPreview: '{ "dependencies": { "framer-motion": "^12.0.0", "react": "^19.0.0" }, "scripts": { "build": "vite build" } }'
    }),
    sourceFile("package-lock.json", {
      kind: "config",
      role: "config",
      textHints: ["lockfile", "dependencies"]
    }),
    sourceFile("vite.config.ts", {
      kind: "config",
      role: "config",
      textHints: ["vite", "proxy", "dev server", "port"]
    })
  ];

  return {
    rootPath: "C:/fixture/replay-saas",
    files,
    totalFiles: files.length,
    scannedFiles: files.length,
    truncated: false,
    notes: []
  };
}

function structuredIntent(overrides: Partial<TaskIntentAnalysis> = {}): TaskIntentAnalysis {
  const structured: StructuredTaskIntent = {
    schemaVersion: 1,
    primaryTargets: [],
    positiveActions: [],
    protectedScopes: [],
    allowedEditScope: "target_with_supporting_context",
    needsStyles: null,
    needsBackend: null,
    ambiguities: [],
    modelNotes: []
  };

  return {
    taskArea: "ui",
    intentTags: [],
    domainTerms: [],
    mentionedEntities: [],
    fileRoleHints: [],
    recommendedSearchTerms: [],
    riskLevel: "medium",
    confidence: 0.82,
    notes: ["Synthetic replay intent."],
    structuredIntent: {
      ...structured,
      ...(overrides.structuredIntent ?? {})
    },
    source: "ollama",
    durationMs: 1,
    ...overrides
  };
}

interface ReplayCase {
  id: string;
  rawTask: string;
  taskType: string;
  intent?: TaskIntentAnalysis;
  expectArea?: TaskArea;
  expectStatus?: "ready" | "warning" | "blocked";
  include?: string[];
  exclude?: string[];
  empty?: boolean;
  minTargetConfidence?: number;
  maxProtectedRisk?: number;
}

function taskAreaIntent(area: TaskArea, terms: string[], protectedScopes: string[] = [], needsBackend: boolean | null = null) {
  return structuredIntent({
    taskArea: area,
    domainTerms: terms,
    structuredIntent: {
      schemaVersion: 1,
      primaryTargets: [],
      positiveActions: terms,
      protectedScopes,
      allowedEditScope: "target_with_supporting_context",
      needsStyles: area === "ui" ? true : null,
      needsBackend,
      ambiguities: [],
      modelNotes: []
    }
  });
}

const replayCases: ReplayCase[] = [
  {
    id: "en-header-overflow",
    rawTask: "Fix the header navigation overflow when the language switch makes labels longer. Do not change backend.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["header", "navigation", "language"], ["backend"], false),
    expectArea: "ui",
    include: ["src/components/Header.tsx"],
    exclude: ["server/index.mjs", "src/api/client.ts"]
  },
  {
    id: "en-more-dropdown",
    rawTask: "Make the More dropdown compact and aligned under the header trigger.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/components/Header.tsx"]
  },
  {
    id: "en-footer-polish",
    rawTask: "Clean up the footer links into product, developers, and legal groups.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/components/Footer.tsx"]
  },
  {
    id: "en-account-badges-api-protected",
    rawTask: "Make provider badges on the account page clearer. API requests must stay unchanged.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["account", "provider", "badges"], ["api requests"], false),
    expectArea: "ui",
    include: ["src/pages/AccountPage.tsx"],
    exclude: ["src/api/client.ts", "server/index.mjs"]
  },
  {
    id: "en-account-fullstack-click",
    rawTask: "Connect the account provider badge click to an API request.",
    taskType: "general",
    intent: taskAreaIntent("fullstack", ["account", "provider", "badge", "api request"], [], true),
    expectArea: "fullstack",
    include: ["src/pages/AccountPage.tsx", "src/api/client.ts", "server/index.mjs"],
    exclude: ["src/pages/OnboardingPage.tsx", "src/components/RouteSkeleton.tsx"]
  },
  {
    id: "en-missing-add-user-form",
    rawTask: "Improve the add user form. Do not change API requests or loading.",
    taskType: "general",
    intent: taskAreaIntent("ui", ["add user form", "user"], ["api requests", "loading"], false),
    expectArea: "ui",
    expectStatus: "blocked",
    empty: true
  },
  {
    id: "en-admin-user-form-protected-api",
    rawTask: "Add a user creation form to the admin page. Do not change API requests or loading.",
    taskType: "general",
    intent: taskAreaIntent("ui", ["admin", "user", "form"], ["api requests", "loading"], false),
    expectArea: "ui",
    include: ["src/pages/AdminPage.tsx"],
    exclude: ["src/api/client.ts", "server/index.mjs"]
  },
  {
    id: "en-dashboard-empty-state",
    rawTask: "Polish the dashboard empty state and recent activity card.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/DashboardPage.tsx"]
  },
  {
    id: "en-devices-pairing-ui",
    rawTask: "Improve the connected devices pairing code screen. Backend pairing API should not change.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["devices", "pairing", "desktop"], ["backend pairing api"], false),
    expectArea: "ui",
    include: ["src/pages/DevicesPage.tsx"],
    exclude: ["server/index.mjs"]
  },
  {
    id: "en-connected-devices-reject-connect-page-hallucination",
    rawTask: "Improve connected devices pairing code screen. Backend pairing API should not change.",
    taskType: "general",
    intent: structuredIntent({
      taskArea: "fullstack",
      domainTerms: ["connected", "devices", "pairing", "pairing code"],
      fileRoleHints: ["api", "route", "service"],
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [{
          kind: "explicit_file",
          value: "src/pages/ConnectPage.tsx",
          path: "src/pages/ConnectPage.tsx",
          confidence: 0.95,
          evidence: "Improve connected devices pairing code screen."
        }],
        positiveActions: [],
        protectedScopes: ["backend pairing api"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: []
      }
    }),
    expectArea: "ui",
    include: ["src/pages/DevicesPage.tsx"],
    exclude: ["src/pages/ConnectPage.tsx", "server/index.mjs", "src/api/client.ts"]
  },
  {
    id: "en-api-keys-fullstack",
    rawTask: "Implement create API key flow with one-time secret display.",
    taskType: "general",
    intent: taskAreaIntent("fullstack", ["api keys", "create", "secret"], [], true),
    expectArea: "fullstack",
    include: ["src/pages/ApiKeysPage.tsx", "src/api/client.ts", "server/index.mjs"]
  },
  {
    id: "en-api-keys-ui-only",
    rawTask: "Make the API keys page empty state less scary. Do not edit server code.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["api keys", "empty state"], ["server"], false),
    expectArea: "ui",
    include: ["src/pages/ApiKeysPage.tsx"],
    exclude: ["server/index.mjs"]
  },
  {
    id: "en-release-empty-state",
    rawTask: "On the releases page, do not show placeholder checksums when an asset is missing.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/ReleasesPage.tsx"]
  },
  {
    id: "en-releases-sync-backend",
    rawTask: "Add GitHub Releases sync handling on the backend. Do not touch release cards UI.",
    taskType: "backend",
    intent: taskAreaIntent("backend", ["github releases sync", "backend"], ["release cards ui"], true),
    expectArea: "backend",
    include: ["server/services/releases.ts", "server/index.mjs"],
    exclude: ["src/pages/ReleasesPage.tsx"]
  },
  {
    id: "en-download-page",
    rawTask: "Improve the download page when no desktop build is attached yet.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/DownloadPage.tsx"]
  },
  {
    id: "en-pricing-copy",
    rawTask: "Adjust pricing page copy and cards for the alpha plan.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/PricingPage.tsx", "src/components/PricingCard.tsx"]
  },
  {
    id: "en-status-page",
    rawTask: "Make the status page show a polished degraded state.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/StatusPage.tsx"]
  },
  {
    id: "en-security-page",
    rawTask: "Update the security page wording around token storage.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/SecurityPage.tsx"]
  },
  {
    id: "en-docs-update",
    rawTask: "Document the desktop update-check API with curl examples.",
    taskType: "docs",
    intent: taskAreaIntent("docs", ["desktop", "update-check", "api reference"], [], null),
    expectArea: "docs",
    include: ["API_REFERENCE.md"]
  },
  {
    id: "en-vite-proxy-config",
    rawTask: "Fix the Vite dev proxy port configuration.",
    taskType: "build",
    expectArea: "build",
    include: ["vite.config.ts"]
  },
  {
    id: "en-auth-callback-bug",
    rawTask: "OAuth callback gets stuck on loading after Google returns. Fix the callback flow.",
    taskType: "bugfix",
    intent: taskAreaIntent("fullstack", ["auth callback", "google", "loading"], [], true),
    expectArea: "fullstack",
    include: ["src/pages/AuthCallbackPage.tsx", "src/api/client.ts", "server/index.mjs"]
  },
  {
    id: "en-login-visual-only",
    rawTask: "Make the login page OAuth buttons feel more premium. No auth logic changes.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["login", "oauth buttons"], ["auth logic"], false),
    expectArea: "ui",
    include: ["src/pages/AuthPage.tsx"],
    exclude: ["server/index.mjs"]
  },
  {
    id: "en-usage-page",
    rawTask: "Polish the usage page quota cards.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/UsagePage.tsx"]
  },
  {
    id: "en-billing-placeholder",
    rawTask: "Make the billing placeholder honest about alpha status.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/BillingPage.tsx"]
  },
  {
    id: "en-workspace-placeholder",
    rawTask: "Improve the workspace invitation placeholder without adding backend.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["workspace", "invitation"], ["backend"], false),
    expectArea: "ui",
    include: ["src/pages/WorkspacePage.tsx"],
    exclude: ["server/index.mjs"]
  },
  {
    id: "en-search-component",
    rawTask: "Fix search input focus and empty results behavior.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/components/SearchBox.tsx"]
  },
  {
    id: "en-roadmap-page",
    rawTask: "Tighten the roadmap milestone cards.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/RoadmapPage.tsx"]
  },
  {
    id: "en-changelog-page",
    rawTask: "Make version history easier to scan on the changelog page.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/ChangelogPage.tsx"]
  },
  {
    id: "en-legal-docs",
    rawTask: "Update legal privacy copy. Do not touch account or auth pages.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["legal", "privacy"], ["account", "auth"], false),
    expectArea: "ui",
    include: ["src/pages/LegalPage.tsx"],
    exclude: ["src/pages/AccountPage.tsx", "src/pages/AuthPage.tsx"]
  },
  {
    id: "en-onboarding-checklist",
    rawTask: "Improve the onboarding checklist layout.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/OnboardingPage.tsx"]
  },
  {
    id: "ru-header",
    rawTask: "\u0418\u0441\u043f\u0440\u0430\u0432\u044c Header: \u0432 \u0440\u0443\u0441\u0441\u043a\u043e\u043c \u044f\u0437\u044b\u043a\u0435 \u043d\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u044f \u043d\u0430\u043b\u0430\u0437\u0438\u0442 \u043d\u0430 \u043a\u043d\u043e\u043f\u043a\u0438.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/components/Header.tsx"]
  },
  {
    id: "ru-account-api-protected",
    rawTask: "\u0421\u0434\u0435\u043b\u0430\u0439 provider badges \u043d\u0430 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0435 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430 \u043f\u043e\u043d\u044f\u0442\u043d\u0435\u0435, API \u043d\u0435 \u043c\u0435\u043d\u044f\u0442\u044c.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["account", "provider badges"], ["api"], false),
    expectArea: "ui",
    include: ["src/pages/AccountPage.tsx"],
    exclude: ["src/api/client.ts", "server/index.mjs"]
  },
  {
    id: "ru-missing-form",
    rawTask: "\u0423\u043b\u0443\u0447\u0448\u0438 \u0444\u043e\u0440\u043c\u0443 \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f. API-\u0437\u0430\u043f\u0440\u043e\u0441\u044b \u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0443 \u043d\u0435 \u043c\u0435\u043d\u044f\u0442\u044c.",
    taskType: "general",
    intent: taskAreaIntent("ui", ["form", "user"], ["api requests", "loading"], false),
    expectArea: "ui",
    expectStatus: "blocked",
    empty: true
  },
  {
    id: "ru-admin-releases",
    rawTask: "\u041d\u0430 \u044d\u043a\u0440\u0430\u043d\u0435 admin \u0441 releases \u0441\u0434\u0435\u043b\u0430\u0439 \u043f\u0443\u0441\u0442\u043e\u0435 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435. Backend \u043d\u0435 \u0442\u0440\u043e\u0433\u0430\u0442\u044c.",
    taskType: "general",
    intent: taskAreaIntent("ui", ["admin", "releases", "empty state"], ["backend"], false),
    expectArea: "ui",
    include: ["src/pages/AdminPage.tsx"],
    exclude: ["server/index.mjs"]
  },
  {
    id: "ru-download",
    rawTask: "\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 Download \u0432\u044b\u0433\u043b\u044f\u0434\u0438\u0442 \u0441\u044b\u0440\u043e, \u0443\u043b\u0443\u0447\u0448\u0438 empty state \u0431\u0435\u0437 backend.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/DownloadPage.tsx"],
    exclude: ["server/index.mjs"]
  },
  {
    id: "ru-docs",
    rawTask: "\u041e\u0431\u043d\u043e\u0432\u0438 docs \u043f\u0440\u043e desktop pairing API \u0438 curl \u043f\u0440\u0438\u043c\u0435\u0440\u044b.",
    taskType: "docs",
    intent: taskAreaIntent("docs", ["desktop pairing api", "curl"], [], null),
    expectArea: "docs",
    include: ["API_REFERENCE.md"]
  },
  {
    id: "es-header-anchor",
    rawTask: "Arregla el Header navigation overflow, no tocar backend.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/components/Header.tsx"],
    exclude: ["server/index.mjs"]
  },
  {
    id: "pt-pricing-anchor",
    rawTask: "Melhore a Pricing page e os plan cards para alpha.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/PricingPage.tsx"]
  },
  {
    id: "zh-header-anchor",
    rawTask: "\u4fee\u590d Header navigation \u5728\u8bed\u8a00\u5207\u6362\u540e\u6ea2\u51fa, do not change backend.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/components/Header.tsx"],
    exclude: ["server/index.mjs"]
  },
  {
    id: "mixed-english-technical-anchor",
    rawTask: "Por favor improve AccountPage provider badges, API no cambiar.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["account", "provider badges"], ["api"], false),
    expectArea: "ui",
    include: ["src/pages/AccountPage.tsx"],
    exclude: ["src/api/client.ts"]
  },
  {
    id: "en-docs-page-ui",
    rawTask: "Make the Docs page setup guide easier to read without changing API behavior.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["docs", "setup guide"], ["api behavior"], false),
    expectArea: "ui",
    include: ["src/pages/DocsPage.tsx"],
    exclude: ["server/index.mjs", "src/api/client.ts"]
  },
  {
    id: "en-developers-page-ui",
    rawTask: "Improve the Developers page API reference layout. Do not change endpoints.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["developers", "api reference", "layout"], ["endpoints"], false),
    expectArea: "ui",
    include: ["src/pages/DevelopersPage.tsx"],
    exclude: ["server/index.mjs"]
  },
  {
    id: "en-devices-heartbeat-ui",
    rawTask: "Polish the desktop devices heartbeat empty state.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/DevicesPage.tsx"]
  },
  {
    id: "en-readme-docs",
    rawTask: "Update README local setup commands for npm workspaces.",
    taskType: "docs",
    intent: taskAreaIntent("docs", ["readme", "setup", "commands"], [], null),
    expectArea: "docs",
    include: ["README.md"]
  },
  {
    id: "en-server-session-bug",
    rawTask: "Fix the server session endpoint returning 500 when no cookie is present.",
    taskType: "backend",
    intent: taskAreaIntent("backend", ["server", "session", "endpoint", "cookie"], [], true),
    expectArea: "backend",
    include: ["server/index.mjs"]
  },
  {
    id: "en-route-skeleton",
    rawTask: "Make the route skeleton loading state calmer.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/components/RouteSkeleton.tsx"]
  },
  {
    id: "en-home-hero",
    rawTask: "Make the home hero CTA copy clearer.",
    taskType: "ui",
    expectArea: "ui",
    include: ["src/pages/HomePage.tsx"]
  },
  {
    id: "pt-security-page",
    rawTask: "Melhorar SecurityPage privacy copy, sem backend.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["security", "privacy"], ["backend"], false),
    expectArea: "ui",
    include: ["src/pages/SecurityPage.tsx"],
    exclude: ["server/index.mjs"]
  },
  {
    id: "es-status-page",
    rawTask: "Ajustar StatusPage incident empty state, no tocar backend.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["status", "incident", "empty state"], ["backend"], false),
    expectArea: "ui",
    include: ["src/pages/StatusPage.tsx"],
    exclude: ["server/index.mjs"]
  },
  {
    id: "zh-docs-page",
    rawTask: "\u66f4\u65b0 DocsPage setup \u6587\u6848, do not change API.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["docs", "setup"], ["api"], false),
    expectArea: "ui",
    include: ["src/pages/DocsPage.tsx"],
    exclude: ["src/api/client.ts"]
  },
  {
    id: "mixed-billing-alpha",
    rawTask: "Polish BillingPage alpha placeholder copy, sin backend.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["billing", "alpha placeholder"], ["backend"], false),
    expectArea: "ui",
    include: ["src/pages/BillingPage.tsx"],
    exclude: ["server/index.mjs"]
  },
  {
    id: "ru-orders-management-missing",
    rawTask: "Сделай красивую страницу управления заказами.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["страница", "управление", "заказы"], [], false),
    expectArea: "ui",
    expectStatus: "blocked",
    empty: true
  },
  {
    id: "ru-account-oauth-badges-reference-support",
    rawTask: "На странице аккаунта сделай красивые badges для подключенных OAuth-провайдеров.",
    taskType: "general",
    intent: taskAreaIntent("ui", ["account", "oauth", "provider", "badge"], [], false),
    expectArea: "ui",
    include: ["src/pages/AccountPage.tsx"],
    exclude: ["src/api/client.ts", "src/contexts/AuthContext.tsx", "server/index.mjs"]
  },
  {
    id: "ru-oauth-callback-redirect",
    rawTask: "Почини OAuth callback redirect после авторизации.",
    taskType: "general",
    intent: taskAreaIntent("backend", ["oauth", "callback", "redirect", "auth"], [], true),
    include: ["src/pages/AuthCallbackPage.tsx"],
    exclude: [".agents/skills/contextforge-auth-backend/SKILL.md", "server/data/db.json"]
  },
  {
    id: "ru-home-animation-library-package",
    rawTask: "Добавь библиотеку для анимаций и используй её на главной странице.",
    taskType: "ui",
    intent: taskAreaIntent("ui", ["home", "animation", "library"], [], false),
    expectArea: "ui",
    include: ["src/pages/HomePage.tsx", "package.json"],
    exclude: ["src/pages/AccountPage.tsx"]
  }
];

function formatFailure(caseItem: ReplayCase, details: string[], selection?: Awaited<ReturnType<typeof selectTaskFiles>>) {
  return [
    `Replay case failed: ${caseItem.id}`,
    `Task: ${caseItem.rawTask}`,
    ...details.map((detail) => `- ${detail}`),
    ...(selection
      ? [
          `Selected details: ${selection.selectedFiles.map((file) => `${file.path} [${file.usage}; ${file.confidence.toFixed(2)}] ${file.reason}`).join(" | ") || "none"}`,
          `Notes: ${selection.notes.join(" | ")}`
        ]
      : [])
  ].join("\n");
}

async function runReplayCase(caseItem: ReplayCase, inventory: ProjectInventory) {
  const selection = await selectTaskFiles({
    rawTask: caseItem.rawTask,
    taskType: caseItem.taskType,
    targetTool: "codex",
    inventory,
    settings: replaySettings,
    taskIntent: caseItem.intent
  });
  const quality = evaluateContextSelectionQuality({
    rawTask: caseItem.rawTask,
    requestedTaskType: caseItem.taskType,
    effectiveTaskArea: selection.effectiveTaskArea,
    inventory,
    fileSelection: selection,
    manualSelectionConfirmed: false,
    contextQualityMode: "balanced"
  });
  const paths = selection.selectedFiles.map((file) => file.path);
  const failures: string[] = [];

  if (caseItem.expectArea && selection.effectiveTaskArea !== caseItem.expectArea) {
    failures.push(`expected area ${caseItem.expectArea}, got ${selection.effectiveTaskArea}`);
  }

  if (caseItem.expectStatus && quality.status !== caseItem.expectStatus) {
    failures.push(`expected quality ${caseItem.expectStatus}, got ${quality.status}`);
  }

  if (caseItem.empty && paths.length !== 0) {
    failures.push(`expected no auto-selected files, got ${paths.join(", ")}`);
  }

  for (const pathValue of caseItem.include ?? []) {
    if (!paths.includes(pathValue)) failures.push(`missing expected file ${pathValue}; selected ${paths.join(", ") || "none"}`);
  }

  for (const pathValue of caseItem.exclude ?? []) {
    const selected = selection.selectedFiles.find((file) => file.path === pathValue);
    if (selected && selected.usage === "inspect-and-edit") failures.push(`protected/unwanted edit target selected: ${pathValue}`);
  }

  if (caseItem.minTargetConfidence != null && quality.signals.targetConfidence < caseItem.minTargetConfidence) {
    failures.push(`target confidence ${quality.signals.targetConfidence} below ${caseItem.minTargetConfidence}`);
  }

  if (caseItem.maxProtectedRisk != null && quality.signals.protectedScopeRisk > caseItem.maxProtectedRisk) {
    failures.push(`protected scope risk ${quality.signals.protectedScopeRisk} above ${caseItem.maxProtectedRisk}`);
  }

  if (failures.length > 0) {
    assert.fail(formatFailure(caseItem, failures, selection));
  }

  return {
    id: caseItem.id,
    area: selection.effectiveTaskArea,
    quality: quality.status,
    score: quality.score,
    targetConfidence: quality.signals.targetConfidence,
    files: paths
  };
}

async function main() {
  const inventory = fixtureInventory();
  const results = [];

  for (const caseItem of replayCases) {
    results.push(await runReplayCase(caseItem, inventory));
  }

  const byArea = new Map<string, number>();
  const byQuality = new Map<string, number>();
  for (const result of results) {
    byArea.set(result.area, (byArea.get(result.area) ?? 0) + 1);
    byQuality.set(result.quality, (byQuality.get(result.quality) ?? 0) + 1);
  }

  console.log(`taskFileSelector replay passed: ${results.length} cases`);
  console.log(`areas: ${Array.from(byArea.entries()).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  console.log(`quality: ${Array.from(byQuality.entries()).map(([key, value]) => `${key}=${value}`).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
