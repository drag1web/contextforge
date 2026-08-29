import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function isAllowedEnvironmentExample(path) {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  return name === ".env.example" || (name.startsWith(".env.") && name.endsWith(".example"));
}

export function repositoryHygieneReason(rawPath) {
  const path = normalizePath(rawPath);
  const lower = path.toLowerCase();
  const name = lower.split("/").at(-1) ?? lower;
  if (lower.startsWith("server/data/")) return "tracked_runtime_workspace_data";
  if (/(?:^|\/)backups\//u.test(lower) || name.includes(".backup.")) return "tracked_backup_artifact";
  if (/\.sqlite(?:$|-)/u.test(name) || name.endsWith(".db") || name.endsWith(".bak")) {
    return "tracked_runtime_database";
  }
  if ((name === ".env" || name.startsWith(".env.")) && !isAllowedEnvironmentExample(lower)) {
    return "tracked_environment_file";
  }
  return null;
}

export function findRepositoryHygieneViolations(paths) {
  return [...new Set(paths.map(normalizePath))]
    .flatMap((path) => {
      const reason = repositoryHygieneReason(path);
      return reason ? [{ path, reason }] : [];
    })
    .sort((left, right) => left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason));
}

export function readTrackedPaths(repositoryRoot = process.cwd()) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error("repository_hygiene_git_inventory_failed");
  return result.stdout.split("\0").filter(Boolean);
}

export function runRepositoryHygieneCheck(repositoryRoot = process.cwd()) {
  const violations = findRepositoryHygieneViolations(readTrackedPaths(repositoryRoot));
  if (violations.length > 0) {
    for (const violation of violations) {
      process.stderr.write(`repository-hygiene: ${violation.reason}: ${violation.path}\n`);
    }
    throw new Error("repository_hygiene_failed");
  }
  process.stdout.write("Repository hygiene check passed.\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runRepositoryHygieneCheck();
  } catch {
    process.exitCode = 1;
  }
}
