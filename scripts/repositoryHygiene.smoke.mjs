import assert from "node:assert/strict";

import {
  findRepositoryHygieneViolations,
  repositoryHygieneReason,
} from "./repositoryHygiene.mjs";

assert.equal(
  repositoryHygieneReason("server/data/backups/contextforge-workspace-backup.json"),
  "tracked_runtime_workspace_data",
);
assert.equal(repositoryHygieneReason(".env.example"), null);
assert.equal(repositoryHygieneReason("config/.env.test.example"), null);
assert.equal(repositoryHygieneReason("fixtures/repository/src/service.ts"), null);
assert.equal(repositoryHygieneReason("config/.env.local"), "tracked_environment_file");
assert.equal(repositoryHygieneReason("runtime/workspace.sqlite-wal"), "tracked_runtime_database");
assert.equal(repositoryHygieneReason("apps/renderer/src/App.backup.txt"), "tracked_backup_artifact");
assert.deepEqual(
  findRepositoryHygieneViolations([
    "fixtures/repository/src/service.ts",
    ".env.example",
    "server/data/backups/private.json",
  ]),
  [{ path: "server/data/backups/private.json", reason: "tracked_runtime_workspace_data" }],
);

process.stdout.write("Repository hygiene smoke passed: 8 scenarios.\n");
