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

export interface ReadinessReport {
  score: number;
  checks: ReadinessCheck[];
  issues: string[];
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

function detectPackageManager(files: string[]) {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("package-lock.json")) return "npm";
  if (files.includes("bun.lockb")) return "bun";

  return null;
}

function detectStack(packageJson: any, files: string[]) {
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  };

  const stack = new Set<string>();

  if (deps.react) stack.add("React");
  if (deps.typescript || files.includes("tsconfig.json")) stack.add("TypeScript");
  if (deps.vite || files.includes("vite.config.ts") || files.includes("vite.config.js")) stack.add("Vite");
  if (deps.electron) stack.add("Electron");
  if (deps.express) stack.add("Express");
  if (deps.pg) stack.add("PostgreSQL");
  if (deps.tailwindcss) stack.add("Tailwind CSS");
  if (deps["framer-motion"]) stack.add("Framer Motion");
  if (files.includes("docker-compose.yml")) stack.add("Docker");

  if (stack.size === 0) {
    stack.add("Unknown");
  }

  return Array.from(stack);
}

function hasScript(scripts: Record<string, string>, name: string) {
  return typeof scripts[name] === "string" && scripts[name].trim().length > 0;
}

function hasAnyFile(files: string[], possibleNames: string[]) {
  return possibleNames.some((fileName) => files.includes(fileName));
}

function hasTests(files: string[], scripts: Record<string, string>) {
  return (
    hasScript(scripts, "test") ||
    files.includes("tests") ||
    files.includes("__tests__") ||
    files.some((file) => file.endsWith(".test.ts")) ||
    files.some((file) => file.endsWith(".test.tsx")) ||
    files.some((file) => file.endsWith(".spec.ts")) ||
    files.some((file) => file.endsWith(".spec.tsx"))
  );
}

function buildReadinessReport(files: string[], scripts: Record<string, string>): ReadinessReport {
  const checks: ReadinessCheck[] = [
    {
      key: "readme",
      label: "README",
      passed: hasAnyFile(files, ["README.md", "readme.md", "README.MD"]),
      points: 15,
      message: "Project has a README file."
    },
    {
      key: "agents",
      label: "AI agent instructions",
      passed: hasAnyFile(files, ["AGENTS.md", "agents.md", "CLAUDE.md", ".cursorrules"]),
      points: 20,
      message: "Project has instructions for AI agents."
    },
    {
      key: "build-script",
      label: "Build command",
      passed: hasScript(scripts, "build"),
      points: 15,
      message: "Project has a build script."
    },
    {
      key: "dev-script",
      label: "Dev command",
      passed: hasScript(scripts, "dev"),
      points: 10,
      message: "Project has a dev script."
    },
    {
      key: "test-script",
      label: "Test command",
      passed: hasScript(scripts, "test"),
      points: 10,
      message: "Project has a test script."
    },
    {
      key: "env-example",
      label: "Environment example",
      passed: hasAnyFile(files, [".env.example", ".env.sample"]),
      points: 10,
      message: "Project has an environment example file."
    },
    {
      key: "typescript-config",
      label: "TypeScript config",
      passed: files.includes("tsconfig.json"),
      points: 10,
      message: "Project has TypeScript configuration."
    },
    {
      key: "tests",
      label: "Tests structure",
      passed: hasTests(files, scripts),
      points: 10,
      message: "Project has tests or a test command."
    }
  ];

  const score = checks.reduce((total, check) => {
    return total + (check.passed ? check.points : 0);
  }, 0);

  const issues = checks
    .filter((check) => !check.passed)
    .map((check) => {
      switch (check.key) {
        case "agents":
          return "No AI agent instruction file found. Add AGENTS.md to make the project easier for AI tools.";
        case "test-script":
          return "No test script found. AI agents will not know how to verify changes.";
        case "env-example":
          return "No .env.example file found. Environment setup may be unclear.";
        case "build-script":
          return "No build script found. AI agents may not know how to validate production build.";
        default:
          return `${check.label} is missing.`;
      }
    });

  return {
    score,
    checks,
    issues
  };
}

export async function scanProject(projectPath: string): Promise<ScannedProject> {
  const projectRoot = await resolveProjectRoot(projectPath);

  const files = await fs.readdir(projectRoot);
  const packageJsonPath = path.join(projectRoot, "package.json");

  let packageJson: any = {};

  try {
    const packageJsonRaw = await fs.readFile(packageJsonPath, "utf-8");
    packageJson = JSON.parse(packageJsonRaw);
  } catch {
    packageJson = {};
  }

  const fallbackName = path.basename(projectRoot);
  const scripts = packageJson.scripts || {};
  const readinessReport = buildReadinessReport(files, scripts);

  return {
    name: packageJson.name || fallbackName,
    localPath: projectRoot,
    packageManager: detectPackageManager(files),
    detectedStack: detectStack(packageJson, files),
    scripts,
    readinessScore: readinessReport.score,
    readinessReport
  };
}