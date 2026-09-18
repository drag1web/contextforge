import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface SqlitePreMigrationBackupInput {
  readonly databasePath: string;
  readonly migrationId: string;
  readonly backupDirectory?: string;
}

export interface SqlitePreMigrationBackupResult {
  readonly fileName: string;
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export function getWorkspaceBackupDirectory(): string {
  return path.resolve(process.cwd(), "data", "backups");
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/gu, "-");
}

/**
 * Preserve the exact persisted sql.js database before a schema migration.
 *
 * The copy lives beside the existing workspace JSON backups but is deliberately
 * not a workspace-backup format revision. It is a recovery artifact for the
 * pre-migration database bytes only.
 */
export function createSqlitePreMigrationBackup(
  input: SqlitePreMigrationBackupInput,
): SqlitePreMigrationBackupResult {
  const databaseBytes = fs.readFileSync(input.databasePath);
  if (databaseBytes.length === 0) {
    throw new Error("Cannot create a pre-migration backup from an empty SQLite file.");
  }

  const backupDirectory = path.resolve(
    input.backupDirectory ?? getWorkspaceBackupDirectory(),
  );
  fs.mkdirSync(backupDirectory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const fileName = [
    "contextforge-sqlite-pre-migration",
    safeFilePart(input.migrationId),
    timestamp,
    randomUUID(),
  ].join("-") + ".sqlite";
  const filePath = path.join(backupDirectory, fileName);
  const temporaryPath = `${filePath}.tmp`;

  try {
    fs.writeFileSync(temporaryPath, databaseBytes, { flag: "wx" });
    const backupBytes = fs.readFileSync(temporaryPath);
    if (
      backupBytes.length !== databaseBytes.length ||
      !backupBytes.equals(databaseBytes)
    ) {
      throw new Error("Pre-migration SQLite backup verification failed.");
    }
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
    throw error;
  }

  return {
    fileName,
    filePath,
    sizeBytes: databaseBytes.length,
    sha256: sha256(databaseBytes),
  };
}
