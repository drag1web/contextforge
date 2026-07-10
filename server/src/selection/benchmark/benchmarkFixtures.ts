import path from "node:path";

import type { ProjectInventory, ProjectInventoryFile } from "../../scanner/projectInventoryScanner.js";

function fixtureFile(pathValue: string, patch: Partial<ProjectInventoryFile> = {}): ProjectInventoryFile {
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
    contentPreview: "",
    sizeBytes: 1200,
    depth: pathValue.split("/").length,
    canReadText: true,
    isLikelyGenerated: false,
    ...patch,
  };
}

function inventory(id: string, files: ProjectInventoryFile[]): ProjectInventory {
  return {
    rootPath: `fixture://${id}`,
    files,
    totalFiles: files.length,
    scannedFiles: files.length,
    truncated: false,
    notes: ["Synthetic benchmark fixture; no user file contents."],
  };
}

const commonDocs = () => [
  fixtureFile("README.md", { kind: "docs", role: "docs", textHints: ["readme", "setup", "architecture", "verification", "commands"] }),
  fixtureFile("docs/ARCHITECTURE.md", { kind: "docs", role: "docs", textHints: ["architecture", "design", "modules"] }),
  fixtureFile("package.json", { kind: "config", role: "config", textHints: ["scripts", "build", "test", "dependencies"] }),
  fixtureFile("tsconfig.json", { kind: "config", role: "config", textHints: ["typescript", "build", "compiler"] }),
  fixtureFile(".env.example", { kind: "config", role: "config", textHints: ["environment variables", "example"] }),
  fixtureFile(".env.local", { kind: "config", role: "config", canReadText: false, textHints: [] }),
];

const reactFixture = inventory("react-stack", [
  fixtureFile("src/pages/DashboardPage.tsx", {
    role: "page", routePath: "/dashboard", symbols: ["DashboardPage"],
    imports: ["../components/DashboardCards", "../hooks/useDashboard", "../styles/dashboard.css"],
    textHints: ["dashboard", "cards", "metrics", "ux"],
  }),
  fixtureFile("src/pages/SettingsPage.tsx", {
    role: "page", routePath: "/settings", symbols: ["SettingsPage"],
    imports: ["../components/SettingsPanel", "../styles/settings.css"], textHints: ["settings", "preferences"],
  }),
  fixtureFile("src/pages/ProjectsPage.tsx", {
    role: "page", routePath: "/projects", symbols: ["ProjectsPage"],
    imports: ["../hooks/useProjects", "../api/projectClient"], textHints: ["projects", "repositories", "list"],
  }),
  fixtureFile("src/pages/DocsPage.tsx", { role: "page", routePath: "/docs", symbols: ["DocsPage"], textHints: ["application docs page"] }),
  fixtureFile("src/pages/OnboardingPage.tsx", { role: "page", routePath: "/onboarding", symbols: ["OnboardingPage"], textHints: ["onboarding", "setup screen"] }),
  fixtureFile("src/components/DashboardCards.tsx", { role: "component", imports: ["../components/Card"], symbols: ["DashboardCards"], textHints: ["dashboard", "cards", "metrics"] }),
  fixtureFile("src/components/SettingsPanel.tsx", { role: "component", symbols: ["SettingsPanel"], textHints: ["settings", "form", "controls"] }),
  fixtureFile("src/components/Card.tsx", { role: "ui-component", symbols: ["Card"], textHints: ["card", "surface"] }),
  fixtureFile("src/components/Modal.tsx", { role: "ui-component", symbols: ["Modal"], textHints: ["modal", "dialog"] }),
  fixtureFile("src/hooks/useDashboard.ts", { role: "hook", imports: ["../api/dashboardClient"], symbols: ["useDashboard"], textHints: ["dashboard", "data", "hook"] }),
  fixtureFile("src/hooks/useProjects.ts", { role: "hook", imports: ["../api/projectClient"], symbols: ["useProjects"], textHints: ["projects", "api client hook"] }),
  fixtureFile("src/api/dashboardClient.ts", { role: "client-api", imports: ["../types/dashboard"], symbols: ["dashboardClient"], textHints: ["dashboard", "api", "client"] }),
  fixtureFile("src/api/projectClient.ts", { role: "client-api", imports: ["../types/projects"], symbols: ["projectClient"], textHints: ["projects", "api", "client"] }),
  fixtureFile("src/types/dashboard.ts", { role: "unknown", symbols: ["DashboardMetric"], textHints: ["dashboard", "types"] }),
  fixtureFile("src/types/projects.ts", { role: "unknown", symbols: ["Project"], textHints: ["projects", "types"] }),
  fixtureFile("src/styles/dashboard.css", { kind: "style", role: "style", textHints: ["dashboard", "cards", "responsive"] }),
  fixtureFile("src/styles/settings.css", { kind: "style", role: "style", textHints: ["settings", "layout"] }),
  fixtureFile("src/styles/global.css", { kind: "style", role: "style", textHints: ["global", "responsive", "layout"] }),
  fixtureFile("src/components/DashboardCards.test.tsx", { kind: "test", role: "test", imports: ["./DashboardCards"], textHints: ["dashboard", "component tests"] }),
  ...commonDocs(),
]);

const expressFixture = inventory("express-stack", [
  fixtureFile("server/src/routes/issues.ts", { role: "api-route", imports: ["../services/githubIssuesService", "../types/githubTypes"], symbols: ["issuesRouter"], textHints: ["endpoint", "github", "issue", "metadata"] }),
  fixtureFile("server/src/routes/orders.ts", { role: "api-route", imports: ["../services/orderService"], symbols: ["ordersRouter"], textHints: ["orders", "endpoint"] }),
  fixtureFile("server/src/services/githubIssuesService.ts", { role: "service", imports: ["../repositories/issueMetadataRepository", "../types/githubTypes"], symbols: ["saveIssueMetadata"], textHints: ["github", "issue", "metadata", "save"] }),
  fixtureFile("server/src/services/orderService.ts", { role: "service", imports: ["../repositories/orderRepository", "../types/orderTypes"], symbols: ["OrderService"], textHints: ["order", "service"] }),
  fixtureFile("server/src/repositories/issueMetadataRepository.ts", { role: "repository", imports: ["../storage/types"], symbols: ["IssueMetadataRepository"], textHints: ["github", "issue", "metadata", "persistence"] }),
  fixtureFile("server/src/repositories/orderRepository.ts", { role: "repository", imports: ["../storage/types"], symbols: ["OrderRepository"], textHints: ["order", "database", "persistence"] }),
  fixtureFile("server/src/storage/types.ts", { role: "store", symbols: ["StorageAdapter", "IssueMetadataRecord"], textHints: ["storage", "persistence", "metadata", "types"] }),
  fixtureFile("server/src/types/githubTypes.ts", { role: "unknown", symbols: ["GitHubIssueMetadata"], textHints: ["github", "issue", "metadata", "types"] }),
  fixtureFile("server/src/types/orderTypes.ts", { role: "unknown", symbols: ["Order"], textHints: ["order", "types"] }),
  fixtureFile("server/src/schema.sql", { kind: "data", role: "db-schema", textHints: ["schema", "database", "issue metadata", "orders"] }),
  fixtureFile("server/src/routes/issues.test.ts", { kind: "test", role: "test", imports: ["./issues"], textHints: ["issues endpoint test"] }),
  fixtureFile("src/pages/IssuesPage.tsx", { role: "page", textHints: ["issues ui"] }),
  ...commonDocs(),
]);

const coreFixture = inventory("selector-core", [
  fixtureFile("server/src/ollama/taskFileSelector.ts", { role: "service", imports: ["../selection/contextQuality", "../selection/safetyPolicy", "../selection/projectSemanticGraph"], symbols: ["selectTaskFiles"], textHints: ["selector", "fallback", "file selection", "manual review"] }),
  fixtureFile("server/src/ollama/taskFileSelector.replay.ts", { kind: "test", role: "test", imports: ["./taskFileSelector"], textHints: ["selector", "replay", "regression"] }),
  fixtureFile("server/src/ollama/taskFileSelector.smoke.ts", { kind: "test", role: "test", imports: ["./taskFileSelector"], textHints: ["selector", "smoke", "safety"] }),
  fixtureFile("server/src/selection/safetyPolicy.ts", { role: "service", symbols: ["detectHardTaskSafetyIssue"], textHints: ["safety", "policy", "secrets", "prompt injection"] }),
  fixtureFile("server/src/selection/contextQuality.ts", { role: "service", symbols: ["evaluateContextSelectionQuality"], textHints: ["quality", "scoring", "confidence", "manual review"] }),
  fixtureFile("server/src/selection/projectSemanticGraph.ts", { role: "service", symbols: ["buildProjectSemanticGraph"], textHints: ["semantic graph", "imports", "relationships"] }),
  fixtureFile("server/src/selection/explicitFileMentions.ts", { role: "service", symbols: ["resolveExplicitFileMentions"], textHints: ["explicit target", "missing target"] }),
  fixtureFile("server/src/contextComposer/contextComposerService.ts", { role: "service", imports: ["../ollama/taskFileSelector"], symbols: ["buildContextComposer"], textHints: ["context composer", "snippets"] }),
  fixtureFile("server/src/scanner/projectInventoryScanner.ts", { role: "service", symbols: ["scanProjectInventory"], textHints: ["scanner", "inventory", "files"] }),
  fixtureFile("server/src/storage/index.ts", { role: "store", textHints: ["storage", "database"] }),
  fixtureFile("apps/desktop/renderer/src/pages/DashboardPage.tsx", { role: "page", textHints: ["dashboard ui"] }),
  ...commonDocs(),
]);

const libraryFixture = inventory("library-stack", [
  fixtureFile("src/index.ts", { role: "app-entry", imports: ["./roiCalculator"], exports: ["calculateRoi"], textHints: ["exports", "library"] }),
  fixtureFile("src/roiCalculator.ts", { role: "service", imports: ["./types"], symbols: ["calculateRoi"], textHints: ["roi", "calculation", "formula"] }),
  fixtureFile("src/types.ts", { role: "unknown", symbols: ["RoiInput", "RoiResult"], textHints: ["roi", "types"] }),
  fixtureFile("tests/roiCalculator.test.ts", { kind: "test", role: "test", imports: ["../src/roiCalculator"], textHints: ["roi", "calculation", "tests"] }),
  fixtureFile("src/exportPdf.ts", { role: "service", textHints: ["pdf", "export"] }),
  ...commonDocs(),
]);

const buildFixture = inventory("build-stack", [
  fixtureFile("package.json", { kind: "config", role: "config", imports: [], textHints: ["scripts", "build", "dev", "dependencies"] }),
  fixtureFile("tsconfig.json", { kind: "config", role: "config", textHints: ["compiler", "paths", "alias"] }),
  fixtureFile("vite.config.ts", { kind: "config", role: "config", imports: ["./src/main"], textHints: ["vite", "proxy", "build", "alias"] }),
  fixtureFile("src/main.ts", { role: "app-entry", imports: ["./App"], symbols: ["main"], textHints: ["entry", "bootstrap"] }),
  fixtureFile("src/App.tsx", { role: "layout", symbols: ["App"], textHints: ["app", "layout"] }),
  fixtureFile(".env.example", { kind: "config", role: "config", textHints: ["environment", "example", "port"] }),
  fixtureFile("README.md", { kind: "docs", role: "docs", textHints: ["setup", "build"] }),
]);

export const benchmarkFixtureInventories: Record<string, ProjectInventory> = {
  "react-stack": reactFixture,
  "review-ui": reactFixture,
  "missing-target": reactFixture,
  "express-stack": expressFixture,
  "selector-core": coreFixture,
  "library-stack": libraryFixture,
  "build-stack": buildFixture,
};

export function getBenchmarkFixture(id: string) {
  const fixture = benchmarkFixtureInventories[id];
  if (!fixture) throw new Error(`Unknown selector benchmark fixture: ${id}`);
  return fixture;
}
