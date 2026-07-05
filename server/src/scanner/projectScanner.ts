import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./projectRootResolver.js";

export interface ReadinessCheck {
  key: string;
  label: string;
  passed: boolean;
  points: number;
  message: string;
}

export interface ScannerPackageSummary {
  path: string;
  name: string | null;
  scripts: Record<string, string>;
}

export interface ScannerSignals {
  packageFiles: string[];
  docs: string[];
  envExamples: string[];
  testFiles: string[];
  testConfigs: string[];
  ciFiles: string[];
  lockFiles: string[];
  configs: string[];
  directories: string[];
  commands: {
    dev: string | null;
    build: string | null;
    test: string | null;
    typecheck: string | null;
    lint: string | null;
  };
  packages: ScannerPackageSummary[];
  inventory: {
    totalFiles: number;
    totalDirectories: number;
    truncated: boolean;
    maxDepth: number;
    maxEntries: number;
  };
}

export interface ReadinessReport {
  score: number;
  checks: ReadinessCheck[];
  issues: string[];
  signals?: ScannerSignals;
}

export interface ScannedProject {
  name: string;
  localPath: string;
  packageManager: string | null;
  detectedStack: string[];
  scripts: Record<string, string>;
  readinessScore: number;
  readinessReport: ReadinessReport;
}

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type PackageInfo = {
  relativePath: string;
  directory: string;
  packageJson: PackageJson;
};

type ScanInventory = {
  files: string[];
  directories: string[];
  truncated: boolean;
};

const MAX_SCAN_DEPTH = 5;
const MAX_SCAN_ENTRIES = 6500;
const MAX_PACKAGE_JSON_BYTES = 512 * 1024;

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".vite",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "dist",
  "build",
  "out",
  "coverage",
  ".coverage",
  "target",
  "bin",
  "obj",
  "vendor",
  ".venv",
  "venv",
  "__pycache__"
]);

const LOCK_FILES = [
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "bun.lockb",
  "bun.lock",
  "npm-shrinkwrap.json"
];

const DOC_FILE_NAMES = new Set([
  "README.md",
  "readme.md",
  "README.MD",
  "AGENTS.md",
  "AGENTS.generated.md",
  "agents.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md"
]);

const ENV_EXAMPLE_NAMES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.local.example",
  ".env.development.example",
  ".env.production.example"
]);

const TEST_CONFIG_PATTERNS = [
  /^vitest\.config\.[cm]?[jt]s$/i,
  /^jest\.config\.[cm]?[jt]s$/i,
  /^playwright\.config\.[cm]?[jt]s$/i,
  /^cypress\.config\.[cm]?[jt]s$/i,
  /^karma\.conf\.[cm]?[jt]s$/i,
  /^wdio\.conf\.[cm]?[jt]s$/i,
  /^test\.[cm]?[jt]s$/i
];

const CONFIG_PATTERNS = [
  /^tsconfig(?:\..+)?\.json$/i,
  /^vite\.config\.[cm]?[jt]s$/i,
  /^webpack\.config\.[cm]?[jt]s$/i,
  /^rollup\.config\.[cm]?[jt]s$/i,
  /^eslint\.config\.[cm]?[jt]s$/i,
  /^tailwind\.config\.[cm]?[jt]s$/i,
  /^docker-compose\.(ya?ml)$/i,
  /^Dockerfile$/i
];

function toPosix(relativePath: string) {
  return relativePath.split(path.sep).join("/");
}

function baseName(relativePath: string) {
  return path.posix.basename(relativePath);
}

function dirName(relativePath: string) {
  const dir = path.posix.dirname(relativePath);
  return dir === "." ? "" : dir;
}

function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/^\.\//, "");
}

function isIgnoredDirectory(name: string) {
  return IGNORED_DIRS.has(name);
}

function isDocsPath(relativePath: string) {
  const name = baseName(relativePath);
  return DOC_FILE_NAMES.has(name) || relativePath === "docs" || relativePath.startsWith("docs/");
}

function isEnvExamplePath(relativePath: string) {
  return ENV_EXAMPLE_NAMES.has(baseName(relativePath));
}

function isTestFilePath(relativePath: string) {
  const name = baseName(relativePath);
  const parts = relativePath.split("/");

  return (
    parts.includes("tests") ||
    parts.includes("__tests__") ||
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(name) ||
    /\.(test|spec)\.mjs$/i.test(name)
  );
}

function isTestConfigPath(relativePath: string) {
  const name = baseName(relativePath);
  return TEST_CONFIG_PATTERNS.some((pattern) => pattern.test(name));
}

function isCiPath(relativePath: string) {
  return (
    /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(relativePath) ||
    relativePath === ".gitlab-ci.yml" ||
    relativePath === "azure-pipelines.yml" ||
    relativePath === "bitbucket-pipelines.yml"
  );
}

function isConfigPath(relativePath: string) {
  const name = baseName(relativePath);
  return CONFIG_PATTERNS.some((pattern) => pattern.test(name));
}

async function collectInventory(projectRoot: string): Promise<ScanInventory> {
  const files: string[] = [];
  const directories: string[] = [];
  let entryCount = 0;
  let truncated = false;

  async function walk(currentDir: string, depth: number) {
    if (truncated || depth > MAX_SCAN_DEPTH) {
      return;
    }

    let entries: import("node:fs").Dirent[];

    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (truncated) break;

      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = toPosix(path.relative(projectRoot, absolutePath));

      if (!relativePath || relativePath.startsWith("..")) {
        continue;
      }

      entryCount += 1;
      if (entryCount > MAX_SCAN_ENTRIES) {
        truncated = true;
        break;
      }

      if (entry.isDirectory()) {
        if (isIgnoredDirectory(entry.name)) {
          continue;
        }

        directories.push(relativePath);
        await walk(absolutePath, depth + 1);
        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  await walk(projectRoot, 0);

  return {
    files,
    directories,
    truncated
  };
}

async function readPackageJson(projectRoot: string, relativePath: string): Promise<PackageInfo | null> {
  const absolutePath = path.join(projectRoot, relativePath);

  try {
    const stats = await fs.stat(absolutePath);

    if (!stats.isFile() || stats.size > MAX_PACKAGE_JSON_BYTES) {
      return null;
    }

    const raw = await fs.readFile(absolutePath, "utf-8");
    const parsed = JSON.parse(raw) as PackageJson;

    return {
      relativePath,
      directory: dirName(relativePath),
      packageJson: parsed
    };
  } catch {
    return null;
  }
}

function packageDisplayPrefix(packageInfo: PackageInfo) {
  return packageInfo.directory ? packageInfo.directory : "root";
}

function aggregateScripts(packageInfos: PackageInfo[]) {
  const scripts: Record<string, string> = {};

  for (const packageInfo of packageInfos) {
    const packageScripts = packageInfo.packageJson.scripts ?? {};
    const prefix = packageDisplayPrefix(packageInfo);

    for (const [name, command] of Object.entries(packageScripts)) {
      if (typeof command !== "string" || command.trim().length === 0) {
        continue;
      }

      if (prefix === "root" && !scripts[name]) {
        scripts[name] = command;
        continue;
      }

      const prefixedName = `${prefix}:${name}`;
      scripts[prefixedName] = command;

      if (!scripts[name]) {
        scripts[name] = command;
      }
    }
  }

  return scripts;
}

function scriptEntries(scripts: Record<string, string>) {
  return Object.entries(scripts).filter(([, command]) => typeof command === "string" && command.trim().length > 0);
}

function hasScript(scripts: Record<string, string>, name: string) {
  return typeof scripts[name] === "string" && scripts[name].trim().length > 0;
}

function findScriptByNames(scripts: Record<string, string>, names: string[]) {
  const direct = names.find((name) => hasScript(scripts, name));
  if (direct) return direct;

  return scriptEntries(scripts).find(([scriptName]) => {
    const lastSegment = scriptName.split(":").at(-1) ?? scriptName;
    return names.includes(lastSegment);
  })?.[0] ?? null;
}

function findScriptByPattern(scripts: Record<string, string>, patterns: RegExp[]) {
  return scriptEntries(scripts).find(([scriptName, command]) => {
    const normalizedName = scriptName.toLowerCase();
    const normalizedCommand = command.toLowerCase();
    return patterns.some((pattern) => pattern.test(normalizedName) || pattern.test(normalizedCommand));
  })?.[0] ?? null;
}

function detectCommandSignals(scripts: Record<string, string>) {
  const dev =
    findScriptByNames(scripts, ["dev", "app", "start", "desktop", "electron", "serve"]) ??
    findScriptByPattern(scripts, [/^dev[:\-]/, /[:\-]dev$/, /vite.*--host/, /electron/, /tsx watch/]);

  const build =
    findScriptByNames(scripts, ["build", "compile", "dist", "package", "make"]) ??
    findScriptByPattern(scripts, [/^build[:\-]/, /[:\-]build$/, /vite build/, /tsc\b/, /electron-builder/]);

  const test =
    findScriptByNames(scripts, ["test", "test:unit", "test:e2e", "unit", "e2e"]) ??
    findScriptByPattern(scripts, [/^test($|[:\-])/, /[:\-]test$/, /vitest/, /jest/, /playwright/, /cypress/]);

  const typecheck =
    findScriptByNames(scripts, ["typecheck", "type-check", "check:types", "tsc"]) ??
    findScriptByPattern(scripts, [/typecheck/, /type-check/, /tsc\b/]);

  const lint =
    findScriptByNames(scripts, ["lint", "lint:fix", "check"]) ??
    findScriptByPattern(scripts, [/^lint($|[:\-])/, /eslint/]);

  return {
    dev,
    build,
    test,
    typecheck,
    lint
  };
}

function detectPackageManager(files: string[]) {
  const names = files.map((file) => baseName(file));

  if (names.includes("pnpm-lock.yaml")) return "pnpm";
  if (names.includes("yarn.lock")) return "yarn";
  if (names.includes("package-lock.json")) return "npm";
  if (names.includes("bun.lockb") || names.includes("bun.lock")) return "bun";

  return null;
}

function collectDependencies(packageInfos: PackageInfo[]) {
  const deps: Record<string, string> = {};

  for (const packageInfo of packageInfos) {
    Object.assign(
      deps,
      packageInfo.packageJson.dependencies,
      packageInfo.packageJson.devDependencies,
      packageInfo.packageJson.peerDependencies,
      packageInfo.packageJson.optionalDependencies
    );
  }

  return deps;
}

function detectStack(packageInfos: PackageInfo[], files: string[], directories: string[]) {
  const deps = collectDependencies(packageInfos);
  const fileSet = new Set(files);
  const dirSet = new Set(directories);
  const stack = new Set<string>();

  if (deps.react || files.some((file) => file.endsWith(".tsx") || file.endsWith(".jsx"))) stack.add("React");
  if (deps.vue) stack.add("Vue");
  if (deps.svelte || dirsContain(dirSet, "src/routes")) stack.add("Svelte");
  if (deps.next || files.some((file) => file.startsWith("app/") && file.endsWith("page.tsx"))) stack.add("Next.js");
  if (deps.typescript || files.some((file) => file.endsWith(".ts") || file.endsWith(".tsx")) || files.some((file) => baseName(file).startsWith("tsconfig") && file.endsWith(".json"))) stack.add("TypeScript");
  if (deps.vite || files.some((file) => /^vite\.config\.[cm]?[jt]s$/i.test(baseName(file)))) stack.add("Vite");
  if (deps.electron || dirSet.has("electron") || directories.some((dir) => dir.endsWith("/electron"))) stack.add("Electron");
  if (deps.express) stack.add("Express");
  if (deps.fastify) stack.add("Fastify");
  if (deps.pg || files.some((file) => file === "docker-compose.yml" || file.endsWith("/docker-compose.yml"))) stack.add("PostgreSQL");
  if (deps["better-sqlite3"] || deps["sqlite3"] || deps["sql.js"]) stack.add("SQLite");
  if (deps.tailwindcss || files.some((file) => /^tailwind\.config\.[cm]?[jt]s$/i.test(baseName(file)))) stack.add("Tailwind CSS");
  if (deps["framer-motion"]) stack.add("Framer Motion");
  if (fileSet.has("pyproject.toml") || files.some((file) => file.endsWith(".py"))) stack.add("Python");
  if (files.some((file) => file.endsWith(".csproj") || file.endsWith(".sln"))) stack.add(".NET");
  if (files.some((file) => file === "pom.xml" || file === "build.gradle" || file === "build.gradle.kts")) stack.add("Java");
  if (files.some((file) => file === "go.mod")) stack.add("Go");
  if (files.some((file) => file === "Cargo.toml")) stack.add("Rust");
  if (files.some((file) => baseName(file) === "Dockerfile") || files.some((file) => /^docker-compose\.(ya?ml)$/i.test(baseName(file)))) stack.add("Docker");

  if (stack.size === 0) {
    stack.add("Unknown");
  }

  return Array.from(stack);
}

function dirsContain(directories: Set<string>, directory: string) {
  return directories.has(directory) || Array.from(directories).some((entry) => entry.endsWith(`/${directory}`));
}

function hasAnyFile(files: string[], possibleNames: string[]) {
  const names = new Set(files.map((file) => baseName(file)));
  return possibleNames.some((fileName) => names.has(fileName));
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.map(normalizeRelativePath).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function buildSignals(
  inventory: ScanInventory,
  packageInfos: PackageInfo[],
  scripts: Record<string, string>
): ScannerSignals {
  const files = inventory.files;
  const directories = inventory.directories;
  const commands = detectCommandSignals(scripts);

  const docs = uniqueSorted([
    ...files.filter(isDocsPath),
    ...directories.filter((dir) => dir === "docs" || dir.startsWith("docs/"))
  ]);

  const testFiles = uniqueSorted(files.filter(isTestFilePath));
  const testConfigs = uniqueSorted(files.filter(isTestConfigPath));

  return {
    packageFiles: uniqueSorted(packageInfos.map((packageInfo) => packageInfo.relativePath)),
    docs,
    envExamples: uniqueSorted(files.filter(isEnvExamplePath)),
    testFiles,
    testConfigs,
    ciFiles: uniqueSorted(files.filter(isCiPath)),
    lockFiles: uniqueSorted(files.filter((file) => LOCK_FILES.includes(baseName(file)))),
    configs: uniqueSorted(files.filter(isConfigPath)),
    directories: uniqueSorted(
      directories
        .filter((dir) =>
          ["src", "client", "server", "app", "apps", "packages", "docs", "tests", "__tests__", ".github"].some(
            (prefix) => dir === prefix || dir.startsWith(`${prefix}/`)
          )
        )
        .slice(0, 80)
    ),
    commands,
    packages: packageInfos.map((packageInfo) => ({
      path: packageInfo.relativePath,
      name: packageInfo.packageJson.name ?? null,
      scripts: packageInfo.packageJson.scripts ?? {}
    })),
    inventory: {
      totalFiles: files.length,
      totalDirectories: directories.length,
      truncated: inventory.truncated,
      maxDepth: MAX_SCAN_DEPTH,
      maxEntries: MAX_SCAN_ENTRIES
    }
  };
}

function buildReadinessReport(signals: ScannerSignals, files: string[], scripts: Record<string, string>): ReadinessReport {
  const hasReadme = hasAnyFile(files, ["README.md", "readme.md", "README.MD"]);
  const hasAgents = hasAnyFile(files, ["AGENTS.md", "AGENTS.generated.md", "agents.md", "CLAUDE.md", ".cursorrules"]);
  const hasDocs = signals.docs.length > 0;
  const hasEnvExample = signals.envExamples.length > 0;
  const hasTsConfig = files.some((file) => /^tsconfig(?:\..+)?\.json$/i.test(baseName(file)));
  const hasTestStructure = signals.testFiles.length > 0 || signals.testConfigs.length > 0;
  const hasCi = signals.ciFiles.length > 0;

  const checks: ReadinessCheck[] = [
    {
      key: "readme",
      label: "README",
      passed: hasReadme,
      points: 12,
      message: hasReadme ? "Project has a README file." : "Add a README with setup, architecture, and verification notes."
    },
    {
      key: "agents",
      label: "AI agent instructions",
      passed: hasAgents,
      points: 15,
      message: hasAgents ? "Project has instructions for AI agents." : "Add AGENTS.md so AI tools can follow stable project rules."
    },
    {
      key: "build-script",
      label: "Build command",
      passed: Boolean(signals.commands.build),
      points: 12,
      message: signals.commands.build ? `Detected build command: ${signals.commands.build}.` : "Add a build script or document production verification."
    },
    {
      key: "dev-script",
      label: "Dev command",
      passed: Boolean(signals.commands.dev),
      points: 10,
      message: signals.commands.dev ? `Detected dev command: ${signals.commands.dev}.` : "Add a dev/start/app script so AI agents know how to run the project locally."
    },
    {
      key: "test-script",
      label: "Test command",
      passed: Boolean(signals.commands.test),
      points: 10,
      message: signals.commands.test ? `Detected test command: ${signals.commands.test}.` : "Add a test script or document manual verification."
    },
    {
      key: "env-example",
      label: "Environment example",
      passed: hasEnvExample,
      points: 10,
      message: hasEnvExample ? "Project has a safe environment example file." : "Add .env.example with placeholder variable names only."
    },
    {
      key: "typescript-config",
      label: "TypeScript config",
      passed: hasTsConfig,
      points: 8,
      message: hasTsConfig ? "Project has TypeScript configuration." : "Add or document type checking configuration when applicable."
    },
    {
      key: "tests",
      label: "Tests structure",
      passed: hasTestStructure,
      points: 10,
      message: hasTestStructure ? "Detected test files or test runner configuration." : "Add tests, test config, or document test strategy."
    },
    {
      key: "docs",
      label: "Documentation",
      passed: hasDocs,
      points: 6,
      message: hasDocs ? "Documentation/context files were detected." : "Add docs or context files to explain the project."
    },
    {
      key: "ci",
      label: "CI workflow",
      passed: hasCi,
      points: 7,
      message: hasCi ? "CI workflow configuration was detected." : "Add CI or document release verification when the project is ready."
    }
  ];

  const score = checks.reduce((total, check) => total + (check.passed ? check.points : 0), 0);

  const issues = checks
    .filter((check) => !check.passed)
    .map((check) => {
      switch (check.key) {
        case "agents":
          return "No AI agent instruction file found. Add AGENTS.md to make the project easier for AI tools.";
        case "test-script":
          if (hasTestStructure) {
            return "Test files/config were detected, but no package script exposes them. Add a test script for AI verification.";
          }
          return "No test script found. AI agents will not know how to verify changes.";
        case "tests":
          if (signals.commands.test) {
            return "A test script exists, but no test files or test config were detected in the scanned project paths.";
          }
          return "Tests structure is missing.";
        case "env-example":
          return "No .env.example file found. Environment setup may be unclear.";
        case "build-script":
          return "No build script found. AI agents may not know how to validate production build.";
        case "dev-script":
          return "Dev command is missing.";
        case "ci":
          return "No CI workflow detected. Add CI later or document manual release checks.";
        default:
          return `${check.label} is missing.`;
      }
    });

  if (signals.inventory.truncated) {
    issues.push(`Project scan was truncated after ${signals.inventory.maxEntries} entries or depth ${signals.inventory.maxDepth}. Some readiness signals may be incomplete.`);
  }

  return {
    score,
    checks,
    issues,
    signals
  };
}

export async function scanProject(projectPath: string): Promise<ScannedProject> {
  const projectRoot = await resolveProjectRoot(projectPath);
  const inventory = await collectInventory(projectRoot);
  const packageJsonPaths = uniqueSorted(inventory.files.filter((file) => baseName(file) === "package.json"));
  const packageInfos = (await Promise.all(packageJsonPaths.map((file) => readPackageJson(projectRoot, file)))).filter(
    (packageInfo): packageInfo is PackageInfo => Boolean(packageInfo)
  );

  const rootPackage = packageInfos.find((packageInfo) => packageInfo.relativePath === "package.json");
  const primaryPackage = rootPackage ?? packageInfos[0] ?? null;
  const fallbackName = path.basename(projectRoot);
  const scripts = aggregateScripts(packageInfos);
  const signals = buildSignals(inventory, packageInfos, scripts);
  const readinessReport = buildReadinessReport(signals, inventory.files, scripts);

  return {
    name: primaryPackage?.packageJson.name || fallbackName,
    localPath: projectRoot,
    packageManager: detectPackageManager(inventory.files),
    detectedStack: detectStack(packageInfos, inventory.files, inventory.directories),
    scripts,
    readinessScore: readinessReport.score,
    readinessReport
  };
}
